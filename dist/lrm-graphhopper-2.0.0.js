(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
function corslite(url, callback, cors) {
    var sent = false;

    if (typeof window.XMLHttpRequest === 'undefined') {
        return callback(Error('Browser not supported'));
    }

    if (typeof cors === 'undefined') {
        var m = url.match(/^\s*https?:\/\/[^\/]*/);
        cors = m && (m[0] !== location.protocol + '//' + location.domain +
                (location.port ? ':' + location.port : ''));
    }

    var x = new window.XMLHttpRequest();

    function isSuccessful(status) {
        return status >= 200 && status < 300 || status === 304;
    }

    if (cors && !('withCredentials' in x)) {
        // IE8-9
        x = new window.XDomainRequest();

        // Ensure callback is never called synchronously, i.e., before
        // x.send() returns (this has been observed in the wild).
        // See https://github.com/mapbox/mapbox.js/issues/472
        var original = callback;
        callback = function() {
            if (sent) {
                original.apply(this, arguments);
            } else {
                var that = this, args = arguments;
                setTimeout(function() {
                    original.apply(that, args);
                }, 0);
            }
        }
    }

    function loaded() {
        if (
            // XDomainRequest
            x.status === undefined ||
            // modern browsers
            isSuccessful(x.status)) callback.call(x, null, x);
        else callback.call(x, x, null);
    }

    // Both `onreadystatechange` and `onload` can fire. `onreadystatechange`
    // has [been supported for longer](http://stackoverflow.com/a/9181508/229001).
    if ('onload' in x) {
        x.onload = loaded;
    } else {
        x.onreadystatechange = function readystate() {
            if (x.readyState === 4) {
                loaded();
            }
        };
    }

    // Call the callback with the XMLHttpRequest object as an error and prevent
    // it from ever being called again by reassigning it to `noop`
    x.onerror = function error(evt) {
        // XDomainRequest provides no evt parameter
        callback.call(this, evt || true, null);
        callback = function() { };
    };

    // IE9 must have onprogress be set to a unique function.
    x.onprogress = function() { };

    x.ontimeout = function(evt) {
        callback.call(this, evt, null);
        callback = function() { };
    };

    x.onabort = function(evt) {
        callback.call(this, evt, null);
        callback = function() { };
    };

    // GET is the only supported HTTP Verb by XDomainRequest and is the
    // only one supported here.
    x.open('GET', url, true);

    // Send the request. Sending data is not supported.
    x.send(null);
    sent = true;

    return x;
}

if (typeof module !== 'undefined') module.exports = corslite;

},{}],2:[function(require,module,exports){
var polyline = {};

// Based off of [the offical Google document](https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
//
// Some parts from [this implementation](http://facstaff.unca.edu/mcmcclur/GoogleMaps/EncodePolyline/PolylineEncoder.js)
// by [Mark McClure](http://facstaff.unca.edu/mcmcclur/)

function encode(coordinate, factor) {
    coordinate = Math.round(coordinate * factor);
    coordinate <<= 1;
    if (coordinate < 0) {
        coordinate = ~coordinate;
    }
    var output = '';
    while (coordinate >= 0x20) {
        output += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63);
        coordinate >>= 5;
    }
    output += String.fromCharCode(coordinate + 63);
    return output;
}

// This is adapted from the implementation in Project-OSRM
// https://github.com/DennisOSRM/Project-OSRM-Web/blob/master/WebContent/routing/OSRM.RoutingGeometry.js
polyline.decode = function(str, precision) {
    var index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    // Coordinates have variable length when encoded, so just keep
    // track of whether we've hit the end of the string. In each
    // loop iteration, a single coordinate is decoded.
    while (index < str.length) {

        // Reset shift, result, and byte
        byte = null;
        shift = 0;
        result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

        shift = result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

        lat += latitude_change;
        lng += longitude_change;

        coordinates.push([lat / factor, lng / factor]);
    }

    return coordinates;
};

polyline.encode = function(coordinates, precision) {
    if (!coordinates.length) return '';

    var factor = Math.pow(10, precision || 5),
        output = encode(coordinates[0][0], factor) + encode(coordinates[0][1], factor);

    for (var i = 1; i < coordinates.length; i++) {
        var a = coordinates[i], b = coordinates[i - 1];
        output += encode(a[0] - b[0], factor);
        output += encode(a[1] - b[1], factor);
    }

    return output;
};

if (typeof module !== undefined) module.exports = polyline;

},{}],3:[function(require,module,exports){
(function (global){
/**
 * GraphHopper routing plugin for Leaflet
 */
(function() {
  'use strict';

  var L = (typeof window !== "undefined" ? window['L'] : typeof global !== "undefined" ? global['L'] : null);
  var corslite = require('corslite');
  var polyline = require('polyline');

  L.Routing = L.Routing || {};

  /**
   * @class L.Routing.GraphHopper
   * @extends L.Evented
   */
  L.Routing.GraphHopper = L.Evented.extend({
    /**
     * Default options
     */
    options: {
      serviceUrl: 'https://graphhopper.com/api/1/route',
      timeout: 30 * 1000,
      urlParameters: {},
      profile: 'car',
      useCustomModel: false,
      customModel: {
        "distance_influence": 15,
        "priority": [
          {
            "if": "road_surface == PAVED",
            "multiply_by": "1.4"
          },
          {
            "if": "road_environment == FERRY",
            "multiply_by": "0.9"
          }
        ],
        "speed": [],
        "areas": {
          "type": "FeatureCollection",
          "features": []
        }
      }
    },

    /**
     * Initialize the routing service
     * @param {string} apiKey - GraphHopper API key
     * @param {Object} options - Options for the router
     */
    initialize: function(apiKey, options) {
      this._apiKey = apiKey;
      L.Util.setOptions(this, options);
    },

    /**
     * Calculate a route
     * @param {Array} waypoints - Array of waypoints
     * @param {Function} callback - Callback function(error, routes)
     * @param {Object} context - Context for the callback
     * @param {Object} options - Additional options for this request
     * @returns {L.Routing.GraphHopper} this
     */
    route: function(waypoints, callback, context, options) {
      var timedOut = false;
      var waypointsCopy = [];
      var url, timer;
      var self = this;

      context = context || callback;
      options = options || {};

      // Create a deep copy of waypoints to avoid async modification issues
      for (var i = 0; i < waypoints.length; i++) {
        waypointsCopy.push({
          latLng: waypoints[i].latLng,
          name: waypoints[i].name,
          options: waypoints[i].options
        });
      }

      // Build the routing URL
      url = this._buildRouteUrl(waypointsCopy, options);

      // Set up timeout handler
      timer = setTimeout(function() {
        timedOut = true;
        callback.call(context, {
          status: -1,
          message: 'GraphHopper request timed out.'
        });
      }, this.options.timeout);

      // Make API request - POST for custom model, GET otherwise
      if (this.options.useCustomModel) {
        this._makePostRequest(url, waypointsCopy, callback, context, timer, timedOut);
      } else {
        this._makeGetRequest(url, waypointsCopy, callback, context, timer, timedOut);
      }

      return this;
    },

    /**
     * Make a POST request for custom model routing
     * @private
     */
    _makePostRequest: function(url, waypoints, callback, context, timer, timedOut) {
      var xhr = new XMLHttpRequest();
      var self = this;

      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          clearTimeout(timer);
          if (!timedOut) {
            self.fire("response", { status: xhr.status });

            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                var data = JSON.parse(xhr.responseText);
                self._processRouteResponse(data, waypoints, callback, context);
              } catch (e) {
                callback.call(context, {
                  status: -1,
                  message: 'Failed to parse GraphHopper response: ' + e.message
                });
              }
            } else {
              self._handleRequestError(xhr.responseText, xhr.statusText, callback, context);
            }
          }
        }
      };

      xhr.send(JSON.stringify(this.options.customModel));
    },

    /**
     * Make a GET request for standard routing
     * @private
     */
    _makeGetRequest: function(url, waypoints, callback, context, timer, timedOut) {
      var self = this;

      corslite(url, function(err, resp) {
        clearTimeout(timer);
        if (!timedOut) {
          self.fire("response", { status: err ? err.status : resp.status });

          if (!err) {
            try {
              var data = JSON.parse(resp.responseText);
              self._processRouteResponse(data, waypoints, callback, context);
            } catch (e) {
              callback.call(context, {
                status: -1,
                message: 'Failed to parse GraphHopper response: ' + e.message
              });
            }
          } else {
            self._handleRequestError(err.responseText, err, callback, context);
          }
        }
      });
    },

    /**
     * Handle error responses from the API
     * @private
     */
    _handleRequestError: function(responseText, err, callback, context) {
      var finalResponse;
      try {
        finalResponse = JSON.parse(responseText);
      } catch (e) {
        finalResponse = responseText;
      }

      callback.call(context, {
        status: -1,
        message: 'HTTP request failed: ' + err,
        response: finalResponse
      });
    },

    /**
     * Process successful route response
     * @private
     */
    _processRouteResponse: function(response, inputWaypoints, callback, context) {
      // Check for API-level errors
      if (this._hasApiErrors(response)) {
        var error = response.info.errors[0];
        callback.call(context, {
          status: error.details,
          message: error.message
        });
        return;
      }

      // Process all route alternatives
      var routes = this._convertRoutes(response.paths, inputWaypoints);
      callback.call(context, null, routes);
    },

    /**
     * Check if the API response contains errors
     * @private
     */
    _hasApiErrors: function(response) {
      return response.info &&
        response.info.errors &&
        response.info.errors.length;
    },

    /**
     * Convert API response paths to route objects
     * @private
     */
    _convertRoutes: function(paths, inputWaypoints) {
      var routes = [];

      for (var i = 0; i < paths.length; i++) {
        var path = paths[i];
        var coordinates = this._decodePolyline(path.points);
        var description = path.description && path.description.join(', ');

        // Handle point order if provided
        var waypoints = inputWaypoints.slice();
        if (path.points_order) {
          var reorderedWaypoints = [];
          for (var j = 0; j < path.points_order.length; j++) {
            reorderedWaypoints.push(inputWaypoints[path.points_order[j]]);
          }
          waypoints = reorderedWaypoints;
        }

        // Map waypoint indices in the returned path
        var mappedWaypoints = this._mapWaypointIndices(
          waypoints,
          path.instructions,
          coordinates
        );

        routes.push({
          name: description || 'Route',
          coordinates: coordinates,
          instructions: this._convertInstructions(path.instructions),
          summary: {
            totalDistance: path.distance,
            totalTime: path.time / 1000,
            totalAscend: path.ascend || 0,
          },
          inputWaypoints: waypoints,
          actualWaypoints: mappedWaypoints.waypoints,
          waypointIndices: mappedWaypoints.waypointIndices
        });
      }

      return routes;
    },

    /**
     * Decode a polyline string to an array of LatLng objects
     * @private
     */
    _decodePolyline: function(encodedPolyline) {
      var coords = polyline.decode(encodedPolyline, 5);
      var latlngs = [];

      for (var i = 0; i < coords.length; i++) {
        latlngs.push(new L.LatLng(coords[i][0], coords[i][1]));
      }

      return latlngs;
    },

    /**
     * Build the URL for a route request
     * @private
     */
    _buildRouteUrl: function(waypoints, options) {
      // Create point parameters for all waypoints
      var pointParams = [];
      for (var i = 0; i < waypoints.length; i++) {
        pointParams.push('point=' + waypoints[i].latLng.lat + ',' + waypoints[i].latLng.lng);
      }

      // Build base URL
      var baseUrl = this.options.serviceUrl + '?' + pointParams.join('&');

      // Add required parameters
      var urlParams = {
        instructions: true,
        type: 'json',
        profile: this.options.profile,
        key: this._apiKey
      };

      // Merge with url parameters from options
      for (var key in this.options.urlParameters) {
        if (this.options.urlParameters.hasOwnProperty(key)) {
          urlParams[key] = this.options.urlParameters[key];
        }
      }

      // Add custom_model flag if needed
      if (this.options.useCustomModel) {
        urlParams.custom_model = true;

        // Add ch=false for custom model as recommended by GraphHopper docs
        urlParams.ch = false;
      }

      // Support for additional features in newer GraphHopper versions
      if (options.alternatives) {
        urlParams.alternative_route = {
          max_paths: options.alternatives
        };
      }

      if (options.avoid) {
        urlParams.avoid = options.avoid;
      }

      return baseUrl + L.Util.getParamString(urlParams, baseUrl);
    },

    /**
     * Convert GraphHopper instructions to a standardized format
     * @private
     */
    _convertInstructions: function(instructions) {
      if (!instructions || !instructions.length) {
        return [];
      }

      var signToType = {
        '-7': 'SlightLeft',
        '-3': 'SharpLeft',
        '-2': 'Left',
        '-1': 'SlightLeft',
        '0': 'Straight',
        '1': 'SlightRight',
        '2': 'Right',
        '3': 'SharpRight',
        '4': 'DestinationReached',
        '5': 'WaypointReached',
        '6': 'Roundabout',
        '7': 'SlightRight'
      };

      var result = [];
      for (var i = 0; i < instructions.length; i++) {
        var instr = instructions[i];
        // First instruction is always a departure
        var type = i === 0 ? 'Head' : signToType[instr.sign.toString()];

        result.push({
          type: type,
          modifier: type,
          text: instr.text,
          distance: instr.distance,
          time: instr.time / 1000, // Convert to seconds
          index: instr.interval[0],
          exit: instr.exit_number
        });
      }

      return result;
    },

    /**
     * Map waypoint indices in the returned path
     * @private
     */
    _mapWaypointIndices: function(waypoints, instructions, coordinates) {
      var resultWaypoints = [];
      var waypointIndices = [];

      // Add first waypoint
      waypointIndices.push(0);
      resultWaypoints.push(new L.Routing.Waypoint(coordinates[0], waypoints[0].name));

      // Process instructions to find waypoints
      if (instructions) {
        for (var i = 0; i < instructions.length; i++) {
          if (instructions[i].sign === 5) { // VIA_REACHED instruction
            var idx = instructions[i].interval[0];
            waypointIndices.push(idx);
            resultWaypoints.push({
              latLng: coordinates[idx],
              name: waypoints[resultWaypoints.length].name
            });
          }
        }
      }

      // Add last waypoint
      waypointIndices.push(coordinates.length - 1);
      resultWaypoints.push({
        latLng: coordinates[coordinates.length - 1],
        name: waypoints[waypoints.length - 1].name
      });

      return {
        waypointIndices: waypointIndices,
        waypoints: resultWaypoints
      };
    }
  });

  /**
   * Factory function to create a new GraphHopper router
   */
  L.Routing.graphHopper = function(apiKey, options) {
    return new L.Routing.GraphHopper(apiKey, options);
  };

  module.exports = L.Routing.GraphHopper;
})();

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"corslite":1,"polyline":2}]},{},[3]);
