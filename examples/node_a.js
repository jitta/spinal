var Spinal = require('../').Node

var spinal = new Spinal('spinal://127.0.0.1:7557', {
  namespace: 'midman'
});

spinal.provide('test', function(data, res){
  console.log('from methods', data)
  res.send(data)
})

spinal.worker('tryCache', function(data, res, options){
  console.log('tryCaching')
  res.cache(10, 'date')
  var ts = (new Date()).getTime()
  res.send(ts)
  // Uncomment the next line if you what to test when your job failed
  // res.error(new Error('test job failed handler'))
})

spinal.start(function(){
  console.log('node_a: `'+this.namespace+'` ready at port ' + this.port)
})

// setTimeout(function(){
//   spinal.stop()
// }, 5000);

// spinal.midman.test(1,2,function(err, result){
//   console.log('>>',result)
// })
