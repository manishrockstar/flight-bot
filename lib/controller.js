/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var debug = require('debug')('bot:controller');
var extend = require('extend');
var Promise = require('bluebird');
var conversation = require('./api/conversation');
var cloudant = require('./api/cloudant');
var skyscanner = require('./api/skyscanner');
var format = require('string-template');
var pick = require('object.pick');

var sendMessageToConversation = Promise.promisify(conversation.message.bind(conversation));
var getUser = Promise.promisify(cloudant.get.bind(cloudant));
var saveUser = Promise.promisify(cloudant.put.bind(cloudant));
var getFlightDetails = Promise.promisify(skyscanner.getFlightDetails.bind(skyscanner));

module.exports = {
  processFlightDetails: function(_message, callback) {
    debug('1. Calling skyscanner API to get flight details...');
    return getFlightDetails({
        origin: _message.context.origin,
        destination: _message.context.destination,
        outbounddate: _message.context.outDate,
        inbounddate: _message.context.returnDate
    })
    .then(function(itinerary) {
      debug('skyscanner response: ' + JSON.stringify(itinerary));
      _message.output.text = itinerary.text;
      _message.context.summary = 'skyscanner results';
      callback(null, _message);
    })
    // Catch any issue we could have during all the steps above
    .catch(function (error) {
      debug(error);
      callback(error);
    });
  },
  /**
   * Process messages from a channel and send a response to the user
   * @param  {Object}   message.user  The user
   * @param  {Object}   message.input The user meesage
   * @param  {Object}   message.context The conversation context
   * @param  {Function} callback The callback
   * @return {void}
   */
  processMessage: function(_message, callback) {
    var message = extend({ input: {text: _message.text} }, _message);
    var input = message.text ? { text: message.text } : message.input;
    var user = message.user || message.from;

    debug('1. Process new message: %s.', JSON.stringify(message.input, null, 2));

    getUser(user).then(function(dbUser) {
      var context = dbUser ? dbUser.context : {};
      message.context = context;

      debug('2. This is the context received: ' + JSON.stringify(message.context));
      debug('3. Send message to Conversation.');

      // 4. Process the response from Conversation
      return sendMessageToConversation(message)
      .then(function(messageResponse) {
        debug('4. Conversation response: %s.', JSON.stringify(messageResponse, null, 2));

        return messageResponse;
      })
      .then(function(messageToUser) {
        debug('5. Save conversation context.');
        if (!dbUser) {
          dbUser = {_id: user};
        }

        // Copying context from messageToUser one by one, skipping skyscanner_api key
        // No need to store the skyscanner_api context value. Only used to trigger
        // 2nd request to obtain flight details from skyscanner
        dbUser.context = {};
        var keys = Object.keys(messageToUser.context);

        for (var i=0;i<keys.length;i++) {
          if (keys[i] != 'skyscanner_api') {
            debug('key ' + i + ': ' + keys[i]);
            dbUser.context[keys[i]] = messageToUser.context[keys[i]];
          }
        }

        return saveUser(dbUser)
        .then(function(data) {
          debug('5. Send response to the user.');
          debug(JSON.stringify(messageToUser, null, 2));
          callback(null, messageToUser);
        });
      })
    })
    // Catch any issue we could have during all the steps above
    .catch(function (error) {
      debug(error);
      callback(error);
    });
  }
}
