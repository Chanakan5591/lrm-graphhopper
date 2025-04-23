/**
 * GraphHopper routing plugin for Leaflet
 */
(function() {
  'use strict';

  var L = require('leaflet');
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
      profile: 'car',
      elevation: false,
      instructions: true,
      locale: 'en',
      pointsEncoded: true,
      details: [],
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
      },
      alternativeRoutes: false,
      maxAlternativeRoutes: 3
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
      var self = this;
      var timer;

      context = context || callback;
      options = options || {};

      // Prepare request payload
      var payload = this._buildRequestPayload(waypoints, options);

      // Set up timeout handler
      timer = setTimeout(function() {
        timedOut = true;
        callback.call(context, {
          status: -1,
          message: 'GraphHopper request timed out.'
        });
      }, this.options.timeout);

      // Make API request
      this._makeRequest(payload, waypoints, callback, context, timer, timedOut);

      return this;
    },

    /**
     * Make a POST request for routing
     * @private
     */
    _makeRequest: function(payload, originalWaypoints, callback, context, timer, timedOut) {
      var xhr = new XMLHttpRequest();
      var self = this;

      xhr.open('POST', this.options.serviceUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) {
          clearTimeout(timer);
          if (!timedOut) {
            self.fire("response", { status: xhr.status });

            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                var data = JSON.parse(xhr.responseText);
                self._processRouteResponse(data, originalWaypoints, callback, context);
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

      xhr.send(JSON.stringify(payload));
    },

    /**
     * Build the request payload object
     * @private
     */
    _buildRequestPayload: function(waypoints, options) {
      var points = [];

      // Convert waypoints to [longitude, latitude] format
      for (var i = 0; i < waypoints.length; i++) {
        points.push([
          waypoints[i].latLng.lng,  // GraphHopper uses [longitude, latitude] order
          waypoints[i].latLng.lat
        ]);
      }

      // Create the base payload
      var payload = {
        points: points,
        profile: options.profile || this.options.profile,
        elevation: options.elevation || this.options.elevation,
        instructions: true, // Always needed for waypoint indices
        locale: options.locale || this.options.locale,
        points_encoded: this.options.pointsEncoded,
        key: this._apiKey
      };

      // Add details if specified
      if (this.options.details && this.options.details.length) {
        payload.details = this.options.details;
      }

      // Add custom model if enabled
      if (this.options.useCustomModel && this.options.customModel) {
        payload.custom_model = this.options.customModel;
        payload["ch.disable"] = true;  // Disable contraction hierarchies for custom model
      }

      // Add alternative routes configuration if needed
      if (this.options.alternativeRoutes) {
        payload.algorithm = "alternative_route";
        payload["alternative_route.max_paths"] = options.maxAlternativeRoutes ||
          this.options.maxAlternativeRoutes;
      }

      // Add avoid areas if specified
      if (options.avoid) {
        payload.avoid = options.avoid;
      }

      return payload;
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
      if (response.message) {
        callback.call(context, {
          status: -1,
          message: response.message
        });
        return;
      }

      // Process all route alternatives
      var routes = this._convertRoutes(response.paths, inputWaypoints);
      callback.call(context, null, routes);
    },

    /**
     * Convert API response paths to route objects
     * @private
     */
    _convertRoutes: function(paths, inputWaypoints) {
      var routes = [];

      for (var i = 0; i < paths.length; i++) {
        var path = paths[i];
        var coordinates = this.options.pointsEncoded ?
          this._decodePolyline(path.points) :
          this._convertCoordinates(path.points);

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
            totalAscend: path.ascend || 0
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
     * Convert raw coordinates to LatLng objects
     * @private
     */
    _convertCoordinates: function(points) {
      var latlngs = [];

      for (var i = 0; i < points.length; i++) {
        // GraphHopper returns [longitude, latitude] format
        latlngs.push(new L.LatLng(points[i][1], points[i][0]));
      }

      return latlngs;
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
