var Kue = require('kue')
var URLparse = require('url').parse
var debug = require('debug')('spinal:queue')
var _ = require('lodash')
var async = require('async')
var _Kues = []

/* istanbul ignore next */
var shutdown = function(sig) {
  console.log('----- Shuting down queue -----')
  for (var i in _Kues) {
    _Kues[i].shutdown(3000, function(err) {
      if(err) console.log('Kue shutdown err: ', err)
      process.exit(0)
    })
  }
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

var Queue = function(broker, options) {
  options = options || {}
  var that = this
  this.broker = broker
  this.job_names = []
  this.queues = {}
  this.redis_config = {}
  this.ttl_buffer = 1000
  this.q = Kue.createQueue({
    prefix: 'q',
    redis: options.redis
  })
  this.q.client.once('connect', function(){
    debug('Queue ready! ... connected with redis')
  })
  _Kues.push(this.q)
  // Kue.app.listen(3000)
}

Queue.prototype.addWorker = function(name) {
  var that = this
  if (this.job_names.indexOf(name) > -1) return false
  debug('Add worker `' + name + '`')
  this.job_names.push(name)
  this.q.process(name, this.jobFn(name))

  // restore previous concurrent num
  this.broker.redis.get("concurrent:" + name).then(function(concurrent){
    if (concurrent) {
      that.setConcurrent(name, concurrent)
      debug('Set ' + name + ' concurrent to ' + concurrent + ' from cache' )
    }
  })
}

Queue.prototype.jobFn = function(name){
  var that = this
  return function(job, done){
    debug('Process ' + name + '(' + job.id + ')')
    that.broker.router.call(name + ':worker', job.data, {timeout: job._ttl - that.ttl_buffer},
      function(err, result, options, job_options){
        /* istanbul ignore if */
        if (err) {
          debug('Job Failed ' + name + '(' + job.id + ')')
          debug(err)
          return done(err)
        }
        if (job_options.logs){
          for (var i = 0; i < job_options.logs.length; i++) {
            job.log(job_options.logs[i])
          }
        }
        done(err, result)
        debug('Finished ' + name + '(' + job.id + ')')
      })
  }
}

Queue.prototype.addJob = function(name, data, options, fn) {
  // if (!this.queues[name]) return false
  this.broker.metrics.meter('broker.queue.add').mark()
  var job = this.q.create(name, data)
    .priority(options.priority || 'normal')
    .removeOnComplete(options.removeOnComplete || false)
    .attempts(options.attempts)
    .ttl((options.ttl ? options.ttl + this.ttl_buffer : 10000 + this.ttl_buffer )) // 10s
    .backoff(options.backoff)
    .delay(options.delay)
    .save(function(err){
      debug('Add job ' + job.type + '(' + job.id + ') ' + JSON.stringify(data))
      fn && fn(err)
    })
  return job
}

/* istanbul ignore next */
Queue.prototype.setConcurrent = function(name, concurrency) {
  var group = _.groupBy(this.q.workers, function(n){ return n.type })
  var that = this
  if (group[name]) {
    var count = group[name].length
    // curcurrent increase/decrase step
    if(typeof concurrency == 'string'){
      if(concurrency[0] == '+' || concurrency[0] == '-'){
        concurrency = count+parseInt(concurrency)
      } else
        concurrency = parseInt(concurrency)
    }
    if (count < concurrency){
      debug('Increase concurrent worker `' + name + '` ' + count + '->' + concurrency)
      for (var i = count; i < concurrency; i++) {
        debug('New worker ' + name + '(' + (i+1) + ')')
        this.q.process(name, this.jobFn(name))
      }
    } else if (count == concurrency) {
      debug('Does not adjust concurrent worker `' + name + '` = ' + count)
    } else {
      debug('Decrease concurrent worker `' + name + '` ' + count + '->' + concurrency)
      for (var i = count-1; i >= concurrency; i--) {
        var work = group[name][i]
        for (var j = 0; j < this.q.workers.length; j++) {
          if (this.q.workers[j].id === work.id){
            that.q.workers.splice(j, 1)
            ;(function(i, j) {
              work.shutdown(function(){
                debug('Drop worker ' + name + '(' + (i+1) + ')')
              })
            })(i, j)
            break
          }
        }
      }
    }
    // save worker num to redis
    debug("Save concurrent:" + name + " to redis = " + concurrency)
    this.broker.redis.set("concurrent:" + name, concurrency)
    return true
  // not found worker
  } else {
    if (this.broker.router.routing[name+':worker']){
      concurrency = parseInt(concurrency)
      if (concurrency <= 0) return false
      debug('New worker ' + name + ' for ' + concurrency)
      this.q.process(name, concurrency, this.jobFn(name))
      return true
    }
    return false
  }
}

Queue.prototype.removeNamespace = function(ns) {
  debug('Removed all `' + ns + '` workers')
  this.setConcurrent(ns, 0)
  _.remove(this.job_names, function(item){ return item.indexOf(ns) == 0 })
}

Queue.prototype.workerCount = function(name) {
  var group = _.groupBy(this.q.workers, function(n){ return n.type })
  var result = {}
  for (var type in group) result[type] = group[type].length
  return result[name] || result
}

Queue.prototype.jobCount = function(callback){
  var groupByTypes = {}
  Kue.singleton.types(function(err, types){
    /* istanbul ignore next */
    function getCountByType(type, done){
      async.parallel({
        inactive: function(cb){ Kue.singleton.card(type + ':inactive', cb) },
        active: function(cb){ Kue.singleton.card(type + ':active', cb) },
        complete: function(cb){ Kue.singleton.card(type + ':complete', cb) },
        failed: function(cb){ Kue.singleton.card(type + ':failed', cb) },
        delayed: function(cb){ Kue.singleton.card(type + ':delayed', cb) },
      }, function parallelCb(err, results){
        groupByTypes[type] = results
        done(err)
      })
    }
    async.each(types, getCountByType, function(err){
      callback(err, groupByTypes)
    })
  })
}

Queue.prototype.onstop = function(done) {
  var that = this
  this.q.shutdown(function(){
    that.q.workers = []
    that.q = null
    done && done()
  })
}


module.exports = Queue
