// Enable strict syntax mode
'use strict';

// Base class
var BudaAgent = require( '../../buda_agent' );

// Custom requirements
var _ = require( 'underscore' );
var util = require( 'util' );
var mongoose = require( 'mongoose' );
var JSONStream = require( 'JSONStream' );
var GJV = require( 'geojson-validation' );

// Private utility method
// Coords should be stored as long,lat; no altitude element included
function removeAltitude( coords ) {
  _.each( coords, function( item ) {
    if( _.isArray( item ) ) {
      // Recursive call for nested arrays at any depth
      removeAltitude( item );
    }

    // If the coords data has three elements,
    // remove the last one ( altitude )
    if( coords.length === 3 ) {
      coords.pop();
    }
  });
}

// Private utility method
// Remove duplicate points in the coords, except for the first/last
// MongoDB fails to index otherwise
function removeDups( coords ) {
  // Store first and last points
  var first = coords.shift();
  var last = coords.pop();
  var result;

  // Remove duplicate from remaining elements
  result = _.uniq( coords, function( point ) {
    return point[ 0 ] + ':' + point[ 1 ];
  });

  // Attach first and last point back in place and assign new coords
  result.unshift( first );
  result.push( last );

  return result;
}

// Constructor method
function BudaGeoJSONAgent( conf, handlers ) {
  var self = this;
  var bag = [];

  BudaAgent.call( this, conf, handlers );

  // Custom schema and data model
  this.storageSchema = new mongoose.Schema({
    data:    { type: mongoose.Schema.Types.Mixed, default: {} },
    geojson: { type: mongoose.Schema.Types.Mixed, index: '2dsphere' }
  });

  // Configure data parser
  this.parser = JSONStream.parse( self.config.options.pointer );

  // Parser errors
  this.parser.on( 'error', function( err ) {
    self.emit( 'error', err );
  });

  // Rewind on complete
  this.parser.on( 'end', function() {
    if( bag.length > 0 ) {
      self.emit( 'batch', bag );
      bag = [];
    }
  });

  // Process records
  this.parser.on( 'data', function( obj ) {
    var i;
    var coords = obj.geometry.coordinates;

    // Remove altitude if required
    if( self.config.options.removeAltitude ) {
      removeAltitude( coords );
    }

    // Remove duplicate points
    if( self.config.options.removeDuplicatePoints ) {
      for( i = 0; i < obj.geometry.coordinates[ 0 ].length; i ++ ) {
        obj.geometry.coordinates[ 0 ] = removeDups( obj.geometry.coordinates[ 0 ] );
      }
    }

    // Final feature validation, only valid GeoJSON features will be stored
    GJV.isFeature( obj, function( valid ) {
      var item;

      if( valid ) {
        item = {
          geojson: obj.geometry,
          data:    {}
        };
        if( obj.properties ) {
          item.data.fromOrigin = obj.properties;
        }
        bag.push( item );
        if( bag.length === ( self.config.storage.batch || 20 ) ) {
          self.emit( 'batch', bag );
          bag = [];
        }
      }
    });
  });
}
util.inherits( BudaGeoJSONAgent, BudaAgent );

module.exports = BudaGeoJSONAgent;
