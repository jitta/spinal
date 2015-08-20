![Spinal](https://raw.githubusercontent.com/jitta/spinal/master/docs/spinal_logo_s.png)

A node.js microservices framework that designs for scalability, simple to write and easy to maintenance

[![Build Status](https://travis-ci.org/jitta/spinal.svg?branch=master)](https://travis-ci.org/jitta/spinal)
[![Coverage Status](https://coveralls.io/repos/jitta/spinal/badge.svg)](https://coveralls.io/r/jitta/spinal)
[![NPM Version](https://img.shields.io/npm/v/spinal.svg)](https://npmjs.org/package/spinal)
[![NPM Downloads](https://img.shields.io/npm/dm/spinal.svg)](https://npmjs.org/package/spinal)

---

## Concept
**Keep a microservice clean as much as posible and let Spinal do the mess part**

We design `Spinal` to help developers to focus on the main objective of that microservice without to worried about others related system like caching, queue, worker, load balancing. **Node must do the main task anything else left to a broker**. Result are rapid development, more quality of microsevice and easy to maintain in long term.


## Installation
```
npm install spinal
```
Want some nigthly development trunk `npm install jitta/spinal#development`

## Features
- Broker
  - Broker will help all nodes connected
  - Health check between nodes and remove if it fail
  - Load balance method calls from all nodes
  - Hosted queue system
- Nodes
  - Multiple namespace
  - Call/Provide method from same namespace or other namespace (two ways)
  - Cache result from method with specific hash key
  - Provide worker to process jobs

## Overview
- [Start](#start)
- [Call method](#call-method)
- [Provide method](#provide-method)
- [Queue](#queue)
- [Cache](#cache)
- [Testing](#testing)
- [Dashboard](#dashboard)
- [Command Line](#command-line)

## Start
Spinal need a broker to handle all call requests between namespace or nodes.
Here is the code how to start a simple broker
```js
var Broker = require('../').Broker;
var broker = new Broker();
broker.start(function(){
  console.log('Spinal:Broker listening...' + this.port)
});
```
This code will start a broker at default port `:7557 ` if you want a broker to listening on other port
```js
broker.start(7777, function(){
   console.log('Spinal:Broker listening on port 7777');
});
```

To add more broker features like queue system and caching system.
You need to start a broker with a redis option.
```js
var Broker = require('../').Broker;
var broker = new Broker({redis: 6379});
```

## Call method
After we got a broker running here is how to create a node connect to a broker that we just started.
```js
var spinal = new Spinal('spinal://127.0.0.1:7557', {
  namespace: 'english'
});

spinal.provide('hello', function(data, res){
  res.send('Hi ' + data.name);
})

spinal.start()
```
Now start another node to call the method
```js
var spinal = new Spinal('spinal://127.0.0.1:7557', {
  namespace: 'thai'
});

spinal.provide('hello', function(data, res){
  res.send('Sawasdee ' + data.name)
}

spinal.call('english.hello', {name: 'hunt'}, function(err, result){
  console.log(result); // Hi hunt
})

spinal.start()
```
Do not forget to `start()` when you want to call some method. Use `call()` and put `namespace.method_name`

## Provide method
```js
spinal.provide('name', function(data, res){
  // send a result
  res.send('A string');
  res.send(12345);
  res.send(true);
  res.send({a: 1, b: 2});
  // send an error
  res.error('Error message');
  res.error(new Error('Error message'));
  // and support nodejs style callback
  res(null , {a: 1, b:2})
  res(new Error('Something wrong!'))
});
```

## Connect a node to a broker
```js
var spinal = new Spinal('spinal://127.0.0.1:7557', { 
  namespace: 'english', // assign node namespace
  
  // OPTIONAL (in case run nodes and a broker on differrent machine)
  // Specific host and port that we want this node to listen
  // and want a broker to connect back to this node 
  hostname: '192.168.1.77',
  port: 8888
});
```

## Queue
To enable queue system we need a broker that start with redis.
```js
// create a worker to process a job
// spinalA namespace is `newsletter`
spinalA.worker('send', function(data, res){
  email.send(data.email, function(){
    res.send('ok');
  });
})

// create a job
spinalB.job('newsletter.send', {email: 'some@one.com'})
.priority('high')            // set priority: low, normal, medium, high, critical
.attempts(2)                 // use 2 times to process a job if it fail. try one more time
.ttl(10000)                  // timeout in 10s
.delay(5000)                 // before start delay for 5s
.backoff(10000)              // after fail retry again in 10s
.save(function(err, job_id){ // don't forget to call save()
  console.log('Created ' + job_id);
});
```

## Call method with options

### Timeout
Normally broker will set default timeout and return error to node
if it's exceed 10 seconds but we can adjust it.
```js
spinal.call('video.conversion',
  {file: 'jitta.mp4'} // first argument need to be set
  {timeout: 60000}, // set timeout option here!
  function (err, result){
    // if exceed timeout option will get an error
    err.message === 'timeout error message'
  }
)
```

### Cache
Broker will cache result from last method call if `cache_id` present
in the options argument. It'll be hit cache after `provide` cached data.

Automatic generate `cache_id` hashing will be develop in the future.

Note: All call can use cache feature even a call inside the same namespace.
To enable cache system we need a broker that start with redis.
```js
spinal.provide('query', function(arg, res){
  db.query('...', function(err, result)){
    if(err) return res.error(err)
    // cache for 1day with cache_id == sector+market
    res.cache(3600, arg.sector + '-' + arg.market)
    res.send(result)
  })
})
spinal.call('stock.query',
  {sector: 'Technology', market: 'US'},
  {cache_id: 'technology-us'},
  function (err, result, options){
    options.from_cache === true // if it hit a cache
  }
)
```

## Testing
Sometime we want to make fixtures for all test case or stub a return result.
Spinal has a solution for this by capture all `call` and replay in your test env
with `spinal.nock.rec()` and `spinal.nock.start()`

```js
var spinal = new Spinal('spinal://127.0.0.1:7557', {namespace: 'english'} );
spinal.nock('/path/to/fixtures') // target path that want to save fixtures
spinal.nock.rec() // enable record system

// and do normally like we do
spinal.start(function(){
  spinal.call('email.send', {email: 'a@b.com'}, function(err, result){
    // then `err` and `result` will be save in the fixtures directory
    // with filename `email.send?email=a@b.com.json`
  })
})
```
Now it's time to replay the data that we saved.
```js
var spinal = new Spinal('spinal://127.0.0.1:7557', {namespace: 'english'} );
spinal.nock('/path/to/fixtures')   // send path to directory that we saved fixtures
spinal.nock.start()                // then start nocking
spinal.nock.start({strict:false})  // or {strict:false} to by pass not exists fixture

spinal.start(function(){
  spinal.call('email.send', {email: 'a@b.com'}, function(err, result){
    // `err` and `result` result will come from fixtures
  })
})
```
If we need to stop recording or nocking by `spinal.nock.stop()`

## Dashboard
Spinal comes with internal dashboard to let us see what going on between
all microservices like numbers of nodes, methods, memory consumed, time usage
from each method and load. This feature provides via a broker so we need to
start a broker with more `restapi` option.
```js
var Broker = require('../').Broker;
var broker = new Broker({redis: 6379, restapi: 7577});
broker.start()
```
Then access `localhost:7577` with your browser you will see it. Not just
a dashboard will start only. You will get queue dashboard (provide by
Kue) and some rest API in JSON format
```
/metrics       - some useful metrics
/nodes         - all nodes data
/methods       - all methods
/queue/worker  - number of workers
/queue/count   - jobs count
```

## Command Line
You can access `spinal` command as a global by `npm install -g spinal` in case
you might want to start broker easier `spinal broker` or `spinal broker -d` for
localhost devlopment enviroment. Incase you want to test a simple method
`spinal call stock.query {sector:'Technology'}`

```
Usage: spinal [options] [command]

Commands:
  console                         run javascript console with spinal enviroment
  call [options] <method> [data]  call spinal method
  job [options] <name> [data]     create a job
  broker [options]                start a broker service

Options:
  -h, --help     output usage information
  -V, --version  output the version number
```

## Roadmap
- Core
  - **Multi-Broker** infinite Brokers to avoid bottlenecks and improve network reliability
  - Event broadcast for each namespace (subscribe, emit)
  - Message broadcast to all nodes
  - Optimize performance
  - Plugin System (put a plugin to run inside Spinal framework)
  - Events Hook
