var Spinal = require('../').Node;
var Broker = require('../').Broker;

describe('Cache', function() {
  var broker = null
  var spinal = null
  beforeEach(function(done){
    broker = new Broker({redis: 6379})
    broker.start(done)
  })
  beforeEach(function(done){
    spinal = new Spinal('spinal://127.0.0.1:7557', { namespace: 'bunny' })
    done()
  })
  afterEach(function(done){ spinal.stop(done) })
  afterEach(function(done){ broker.stop(done) })


  it('Call method first time should return fresh', function(done) {
    spinal.provide('jump', function(data, res){
      res.cache(1, 'KEY')
      res.send('ok')
    })
    spinal.start(function(){
      spinal.call('jump', 'req', function(err, data, header){
        assert.isNull(err)
        assert.equal(data, 'ok')
        assert.isUndefined(header.from_cache)
        done()
      })
    })
  })

  it('Call method second time should return cache', function(done) {
    spinal.provide('jump2', function(data, res){
      res.cache(1, 'KEY')
      res.send('ok')
    })
    spinal.start(function(){
      spinal.call('jump2', 'req', function(err, data, header){
        expect(err).to.be.null
        expect(data).to.equal('ok')
        expect(header.from_cache).to.be.undefined
        spinal.call('jump2', 'req', {cache_id :'KEY'}, function(err, data, header){
          expect(header.from_cache).to.be.true
          expect(data).to.equal('ok')
          done()
        })
      })
    })
  })

  it('Caching should be great when using automate `cache_id`', function(done) {
    spinal.provide('jump3', function(data, res){
      res.cache(1, true)
      res.send('ok')
    })
    spinal.start(function(){
      spinal.call('jump3', 'req', function(err, data, header){
        expect(err).to.be.null
        expect(data).to.equal('ok')
        expect(header.from_cache).to.be.undefined
        spinal.call('jump3', 'req', {cache_id: true}, function(err, data, header){
          expect(header.from_cache).to.be.true
          expect(data).to.equal('ok')
          done()
        })
      })
    })
  })

  it('Support Object in cache result', function(done){
    var mock = {result: 'string', a: 1, b: true, a: [1,2,3, {b: 'c'}]}
    spinal.provide('jump3', function(data, res){
      res.cache(1, 'KEY')
      res.send(mock)
    })
    spinal.start(function(){
      spinal.call('jump3', 'req', function(err, data, header){
        expect(err).to.be.null
        expect(data).to.deep.equal(mock)
        expect(header.from_cache).to.be.undefined
        spinal.call('jump3', 'req', {cache_id :'KEY'}, function(err, data, header){
          expect(header.from_cache).to.be.true
          expect(data).to.deep.equal(mock)
          done()
        })
      })
    })
  })

  it('Data from cache should expire specific TTL', function(done) {
    spinal.provide('jump3', function(data, res){
      res.cache(1, 'KEY')
      res.send('ok')
    })
    spinal.start(function(){
      spinal.call('jump3', 'req', function(err, data, header){
        expect(err).to.be.null
        expect(data).to.equal('ok')
        assert.isUndefined(header.from_cache)
        spinal.call('jump3', 'req', {cache_id :'KEY'}, function(err, data, header){
          expect(header.from_cache).to.be.true
          expect(data).to.equal('ok')
        })
        setTimeout(function(){
          spinal.call('jump3', 'req', {cache_id :'KEY'}, function(err, data, header){
            expect(header.from_cache).to.be.undefined
            expect(header.cache_id).to.equal('KEY')
            done()
          })
        }, 1500)
      })
    })
  })

})
