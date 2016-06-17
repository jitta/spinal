var rpc = require('pm2-axon-rpc')
  , axon = require('pm2-axon')
  , async = require('async')
  , _ = require('lodash')
  , puid = new (require('puid'))(false)
  , debug = require('debug')('spinal:node')
  , EventEmitter = require("events").EventEmitter
  , Nock = require('./nock')
  , Package = require('../package.json')

var URLparse = require('url').parse
var _reserved_namespace = ['broker', 'queue', 'on', 'emit', 'methods']
var HEARTBEAT_INTERVAL = 5000

//
// helper
//

function getPort (cb) {
  var server = require('net').createServer()
  server.listen(0)
  server.on('listening', function () {
    var port = server.address().port
    server.once('close', function () {
      cb(port)
    })
    server.close()
  })
}

//
// Spinal core
//

var Spinal = function(url, options){
  var that = this
  if (typeof options == 'undefined') options = {}

  var rep = axon.socket('rep')
  var req = axon.socket('req')
  this.id = puid.generate()
  this.server = new rpc.Server(rep)
  this.client = new rpc.Client(req)
  this.broker_url = process.env.SPINAL_BROKER || url
  this.hostname = process.env.SPINAL_HOST || options.hostname
  this.port = parseInt(process.env.SPINAL_PORT || options.port)
  this.namespace = options.namespace
  this.timeout = {}
  this.initialized = false
  this.connected = false
  this._broker_data = {
    version: null,
    methods: []
  }
  this.config = {}
  this.nock = new Nock(this)
  if (options.heartbeat_interval) HEARTBEAT_INTERVAL = parseInt(options.heartbeat_interval)

  // validate
  if (typeof this.broker_url == 'undefined')
    throw new Error("Spinal needs a broker url in the first argument")
  if (typeof this.namespace == 'undefined')
    throw new Error("Spinal needs `options.namespace` to initialize")
  if (_reserved_namespace.indexOf(this.namespace) > -1)
    throw new Error("`" + this.namespace + "` may not be used as a namespace")

  // internal methods
  this._methods = {}
  this._methodMiddlerwares = {}

  // stats
  this.stats = {
    reconnected: 0
  }

  // TODO: broker broadcast namespace
  // this.server.expose('_message', function(err, data){
  //   debug('broker message', data)
  //   console.log(arguments)
  // })

  this.server.expose('rpc', function(name, arg, options, reply){
    // TODO: options like caching, error, ...
    /* istanbul ignore else */
    if (that._methods[name]){
      debug(that.namespace + '[rpc] ' + name)
      reply._options = options
      that._methods[name](arg, reply)
    } else {
      debug(that.namespace + '[rpc] ' + name + ' method not found')
      reply(new Error(that.namespace + " no method found `" + that.name + "`"))
    }
  })

  debug(that.namespace+'('+that.id+') new node')

}
//
// Prototype
//

// event emitter
Spinal.prototype.__proto__ = EventEmitter.prototype

Spinal.prototype.set = function(key, val) {
  return this.config[key] = val
}

Spinal.prototype.get = function(key) {
  return this.config[key]
}

Spinal.prototype.unset = function(key) {
  delete this.config[key]
  return true
}

// spinal node initilization
Spinal.prototype.start = function(callback){
  var that = this
  var rep = this.server.sock
  var req = this.client.sock

  var url = URLparse(this.broker_url)
  url.port = parseInt(url.port) || 7557

  this.once('ready', function(){
    callback && callback.apply(that, null)
  })

  var init = function(port, hostname){
    debug(that.namespace+'('+that.id+') start() at :'+port)
    // export methods name for broker
    var export_methods = []
    for(var i in that._methods){
      export_methods.push(that.namespace+'.'+i)
    }
    var data = {
      id: that.id,
      namespace: that.namespace,
      hostname: that.hostname, // TODO: dynamic IP
      heartbeat_interval: HEARTBEAT_INTERVAL,
      port: port,
      version: Package.version,
      methods: export_methods
    }
    var handshake = function(){
      debug(that.namespace + '(' + that.id +') req handshake')
      that.client.call('_handshake', data, function(err, res){
        debug(that.namespace + '(' + that.id +') handshaked with broker')
        that.connected = true
        that.emit('ready', that.client)
        var ping = function(){
          clearTimeout(that.timeout.heartbeat)
          if (that.client.sock.connected){
            that.client.call('_heartbeat', {
              id: data.id, version: that._broker_data.version
            }, function(err, res){
              // something ...
            })
            that.timeout.heartbeat = setTimeout(ping, HEARTBEAT_INTERVAL)
          }
        }
        that.timeout.heartbeat = setTimeout(ping, HEARTBEAT_INTERVAL)
      })
    }
    // TODO: error handle in the future
    if(that.connected) return that.emit('ready')
    if (!that.initialized){
      that.initialized = true
      /* istanbul ignore next */
      req.on('error', function(err){ console.error(that.namespace+'('+that.id+') req.error : ', err) })
      req.on('reconnect attempt', function(){
        that.stats.reconnected++
        this.connected = false
        debug(that.id + ' reconnecting...')
      })
      req.on('connect', handshake)
    }
    rep.once('bind', function(){
      that.emit('listening')
      // after listening ready connect to broker
      debug('Connect to broker %s', url.href)
      req.connect(url.port, url.hostname)
    })
    rep.bind(port)
  }

  // start listening for broker request
  if(isFinite(this.port))
    init(this.port, this.hostname)
  else
    getPort(function(port){
      that.port = port
      init(port, that.hostname)
    })
}

// spinal node destructor
Spinal.prototype.stop = function(fn){
  var that = this
  var rep = this.server.sock
  var req = this.client.sock
  debug(that.namespace+'('+that.id+') stop()')
  if(req.socks.length > 0){
    // try to close sockets
    var close = function(done){
      try {
        req.close()
        rep.close(function(){
          that.connected = false
          done()
        })
      } catch (e) {}
    }
    var stopTimeout = setTimeout(function(){
      debug(that.namespace+'('+that.id+') stopped by timeout', that.id)
      close(fn)
    }, HEARTBEAT_INTERVAL*2)
    this.client.call('_bye', this.id, function(){
      clearTimeout(stopTimeout)
      debug(that.namespace+'('+that.id+') stopped')
      close(fn)
    })
  } else {
    debug(that.namespace+'('+that.id+') stopped without start')
    fn && fn()
    // fn = null
  }
}

Spinal.prototype.ping = function(fn){
  this.client.call('_ping', this.id, fn)
}

//
// RPC
//

Spinal.prototype.provide = function(name, fn){
  if (this._methods[name])
    return this._methodMiddlerwares[name].push(fn)
  if (this.initialized)
    throw new Error("Cannot provide a new method after node connected to a broker")
  if (typeof fn !== 'function')
    throw new Error("Provide need a function not a "+(typeof fn))

  debug('register method('+name+')')
  var fn_name = this.namespace+'.'+name
  var that = this

  this._methodMiddlerwares[name] = []
  this._methodMiddlerwares[name].push(fn)

  // middleware spinal rpc
  this._methods[name] = function(arg, callback){
    // TODO: timeout handle
    var options = {}
    var reply = function(){
      arguments = [].slice.call(arguments)
      if (arguments && arguments[0] && Object.isEmpty(arguments[0])) arguments = []
      callback.apply(null, arguments)
      that.emit('call done', name, arguments)
    }
    reply.log = function(data){
      if(!options.logs) options.logs = []
      options.logs.push(String(data))
    }
    reply.cache = function(ttl, key){
      options.cache = {
        ttl: ttl,
        key: key
      }
    }
    reply.send = function(data){
      callback(null, data, options)
      that.emit('call done', name, [null, data, options])
    }
    reply.error = function(err){
      if(typeof err === 'string') err = new Error(err)
      err.options = options
      callback(err)
      that.emit('call done', name, [err])
    }
    // reply.reject = function(){}
    if (that._methodMiddlerwares[name].length === 1) {
      that._methodMiddlerwares[name][0](arg, reply, options)
    }
    else {
      var _lastFn = that._methodMiddlerwares[name].slice(-1)[0]
      var _middlewares = that._methodMiddlerwares[name].slice(0, -1)

      async.series(_middlewares.map(function(_fn) {
        return function(cb) {
          _fn(arg, reply, options, cb)
        }
      }), function (errors, results) {
        if (errors)
          return reply.error(errors)

        _lastFn(arg, reply, options)
      })
    }
  }
  this.emit('provide', name)
}

Spinal.prototype.unprovide = function(name){
  if(this._methods[name]){
    delete this._methods[name]
    this.emit('unprovide', name)
    return true
  }
}

Spinal.prototype.call = function(name, arg, options, callback){
  if (name.indexOf('.') === -1) name = this.namespace + '.' + name
  if (typeof arg === 'function'){
    callback = arg
    arg = null
    options = {}
    arguments = [name, arg, options, callback]
  } else if (typeof options === 'function'){
    callback = options
    options = {}
    arguments = [name, arg, options, callback]
  } else arguments = [].slice.call(arguments)

  if(typeof callback !== 'function')
    throw new Error('spinal.call() need a function for callback')

  if (options.timeout === undefined && isFinite(this.config.callTimeout)) {
    options.timeout = this.config.callTimeout
  }

  // middleware spinal rpc
  callback = arguments.pop()
  arguments.push(function(err, data, options){
    callback(err, data, options)
  })

  arguments.unshift('rpc')
  this.client.call.apply(this.client, arguments)
  this.emit('call', name, arg, options)
}

//
// Worker
//

Spinal.prototype.worker = function(name, fn){
  this.provide.apply(this, [name + ':worker', fn])
}

Spinal.prototype.job = function(name, data){
  if (name.indexOf('.') == -1) name = this.namespace + '.' + name
  var that = this
  var options = {}
  return {
    priority: function(priority){ options.priority = priority; return this },
    attempts: function(attempts){ options.attempts = attempts; return this },
    backoff: function(backoff){ options.backoff = backoff; return this },
    ttl: function(ttl){ options.ttl = ttl; return this },
    delay: function(delay){ options.delay = delay; return this },
    save: function(callback){
      if (typeof callback == 'undefined') callback = function(){}
      var arg = ['jobAdd', name, data, options, callback]
      that.client.call.apply(that.client, arg)
    }
  }

}

module.exports = Spinal
