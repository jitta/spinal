var Spinal = require('../').Node

var spinal = new Spinal('spinal://127.0.0.1:7557', {
  namespace: 'blackman'
})

spinal.provide('loadStock', function(data, res){
  console.log('from loadStock methods', data)
  res.send(data)
})

spinal.start(function(){
  console.log('node_b: `'+this.namespace+'` ready')
  setTimeout(function(){
    spinal.job('midman.tryCache', {stock_id:'NASDAQ:AAPL'}, {cache_id:'date'})
      // Set this option to let Kue remove your jobs when they are completed (not failed).
      // This will prevent your Redis eat up all of the memory.
      // .removeOnComplete(true)
      .onComplete(function(result) {
        console.log('complete', result)
      })
      .save(function(err, jobId) {
        console.log('saved', arguments)
      })
  }, 1000)
})

process.on('SIGINT', function() {
  spinal.stop(process.exit)
});

var spinal2 = new Spinal('spinal://127.0.0.1:7557', {
  namespace: 'cat', port: 3009
})
// spinal2.start()
