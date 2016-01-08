var pathToRegexp = Npm.require('path-to-regexp');
var Fiber = Npm.require('fibers');
var urlParse = Npm.require('url').parse;

PickerImp = function(filterFunction, parentRouter) {
  this.filterFunction = filterFunction;
  this.parentRouter = parentRouter;
  this.routes = [];
  this.subRouters = [];
  this.middlewares = [];
  this.errorMiddlewares = [];
}

PickerImp.prototype.middleware = function(callback) {
  if(callback.length === 3) {
    this.middlewares.push(callback);
  } else {
    this.errorMiddlewares.push(callback);
  }
};

PickerImp.prototype.route = function(path, callback) {
  var regExp = pathToRegexp(path);
  regExp.callback = callback;
  this.routes.push(regExp);
  return this;
};

PickerImp.prototype.filter = function(callback) {
  var subRouter = new PickerImp(callback, this);
  this.subRouters.push(subRouter);
  return subRouter;
};

PickerImp.prototype._dispatch = function(err, req, res, bypass) {
  var self = this;
  var currentRoute = 0;
  var currentSubRouter = 0;
  var currentMiddleware = 0;
  var currentErrorMidleware = 0;

  if(this.filterFunction) {
    var result = this.filterFunction(req, res);
    if(!result) {
      return bypass();
    }
  }
  
  processNextMiddleware(err);
  function processNextMiddleware(currErr) {
    if(currErr) {
      processNextErrorMidleware(currErr);
      return;
    }
    var middleware = self.middlewares[currentMiddleware++];
    if(middleware) {
      self._processMiddleware(middleware, null, req, res, processNextMiddleware);
    } else {
      processNextRoute();
    }
  }
  
  function processNextRoute () {
    var route = self.routes[currentRoute++];
    if(route) {
      var uri = req.url.replace(/\?.*/, '');
      var m = uri.match(route);
      if(m) {
        var params = self._buildParams(route.keys, m);
        params.query = urlParse(req.url, true).query;
        self._processRoute(route.callback, params, req, res, function(currErr) {
          if(currErr) processNextErrorMidleware(currErr);
          else bypass();
        });
      } else {
        processNextRoute();
      }
    } else {
      processNextSubRouter();
    } 
  }
  
  function processNextSubRouter () {
    var subRouter = self.subRouters[currentSubRouter++];
    if(subRouter) {
      subRouter._dispatch(null, req, res, processNextSubRouter);
    } else {
      bypass();
    }
  }
  
  function processNextErrorMidleware(currErr) {
    var middleware = self.errorMiddlewares[currentErrorMidleware++];
    if(middleware) {
      self._processMiddleware(middleware, currErr, req, res, processNextErrorMidleware);
    } else if(self.parentRouter) {
      self.parentRouter._dispatch(currErr, req, res, function() {});
    } else{
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal server error (unhandled)');
    }
  }
};

PickerImp.prototype._buildParams = function(keys, m) {
  var params = {};
  for(var lc=1; lc<m.length; lc++) {
    var key = keys[lc-1].name;
    var value = m[lc];
    params[key] = value;
  }

  return params;
};

PickerImp.prototype._processRoute = function(callback, params, req, res, next) {
  if(Fiber.current) {
    doCall();
  } else {
    new Fiber(doCall).run();
  }

  function doCall () {
    callback.call(null, params, req, res, next); 
  }
};

PickerImp.prototype._processMiddleware = function(middleware, err, req, res, next) {
  if(Fiber.current) {
    doCall();
  } else {
    new Fiber(doCall).run();
  }

  function doCall() {
    var arity = middleware.length;
    var hasError = Boolean(err);
    var error = err;
    
    try {
      if(hasError && arity === 4) {
        middleware.call(null, error, req, res, next);
        return;
      }
      if(!hasError && arity === 3) {
        middleware.call(null, req, res, next);
        return;
      }
    } catch(e) {
      error = e;
    }
    
    next(error);
  }
};