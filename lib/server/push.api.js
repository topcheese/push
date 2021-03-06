/*
  A general purpose user CordovaPush
  ios, android, mail, twitter?, facebook?, sms?, snailMail? :)

  Phonegap generic :
  https://github.com/phonegap-build/PushPlugin
 */

// getText / getBinary

Push.setBadge = function(id, count) {
    // throw new Error('Push.setBadge not implemented on the server');
};

var isConfigured = false;

Push.Configure = function(options) {
    var self = this;
    // https://npmjs.org/package/apn

    // After requesting the certificate from Apple, export your private key as a .p12 file and download the .cer file from the iOS Provisioning Portal.

    // gateway.push.apple.com, port 2195
    // gateway.sandbox.push.apple.com, port 2195

    // Now, in the directory containing cert.cer and key.p12 execute the following commands to generate your .pem files:
    // $ openssl x509 -in cert.cer -inform DER -outform PEM -out cert.pem
    // $ openssl pkcs12 -in key.p12 -out key.pem -nodes

    // Block multiple calls
    if (isConfigured)
      throw new Error('Push.Configure should not be called more than once!');

    isConfigured = true;

    // Add debug info
    if (Push.debug) console.log('Push.Configure', options);

    // This function is called when a token is replaced on a device - normally
    // this should not happen, but if it does we should take action on it
    _replaceToken = function(currentToken, newToken) {
        // console.log('Replace token: ' + currentToken + ' -- ' + newToken);
        // If the server gets a token event its passing in the current token and
        // the new value - if new value is undefined this empty the token
        self.emit('token', currentToken, newToken);
    };

    // Rig the removeToken callback
    _removeToken = function(token) {
        // console.log('Remove token: ' + token);
        // Invalidate the token
        self.emit('token', token, null);
    };


    if (options.apn) {
        if (Push.debug) console.log('Push: APN configured');

        // Allow production to be a general option for push notifications
        if (options.production)
          options.apn.production = true;

        // We check the apn gateway i the options, we could risk shipping
        // server into production while using the production configuration.
        // On the other hand we could be in development but using the production
        // configuration. And finally we could have configured an unknown apn
        // gateway (this could change in the future - but a warning about typos
        // can save hours of debugging)
        //
        // Warn about gateway configurations - it's more a guide
        if (options.apn.gateway) {

            if (options.apn.gateway == 'gateway.sandbox.push.apple.com') {
                // Using the development sandbox
                console.warn('WARNING: Push APN is in development mode');
            } else if (options.apn.gateway == 'gateway.push.apple.com') {
                // In production - but warn if we are running on localhost
                if (/http:\/\/localhost/.test(Meteor.absoluteUrl())) {
                    console.warn('WARNING: Push APN is configured to production mode - but server is running from localhost');
                }
            } else {
                // Warn about gateways we dont know about
                console.warn('WARNING: Push APN unkown gateway "' + options.apn.gateway + '"');
            }

        } else {
            if (options.apn.production) {
                if (/http:\/\/localhost/.test(Meteor.absoluteUrl())) {
                    console.warn('WARNING: Push APN is configured to production mode - but server is running from localhost');
                }
            } else {
                console.warn('WARNING: Push APN is in development mode');
            }
        }

        // Check certificate data
        if (!options.apn['certData'] || !options.apn['certData'].length)
            console.error('ERROR: Push server could not find certData');

        // Check key data
        if (!options.apn['keyData'] || !options.apn['keyData'].length)
            console.error('ERROR: Push server could not find keyData');

        // Rig apn connection
        var apn = Npm.require('apn');
        var apnConnection = new apn.Connection( options.apn );


        // XXX: should we do a test of the connection? It would be nice to know
        // That the server/certificates/network are correct configured

        // apnConnection.connect().then(function() {
        //     console.info('CHECK: Push APN connection OK');
        // }, function(err) {
        //     console.warn('CHECK: Push APN connection FAILURE');
        // });
        // Note: the above code spoils the connection - investigate how to
        // shutdown/close it.

        self.sendAPN = function(userToken, notification) {
            // console.log('sendAPN', notification.from, userToken, notification.title, notification.text, notification.badge, notification.priority);
            var priority = (notification.priority || notification.priority === 0)? notification.priority : 10;

            var myDevice = new apn.Device(userToken);

            var note = new apn.Notification();

            note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
            if (typeof notification.badge !== 'undefined') note.badge = notification.badge;
            if (typeof notification.sound !== 'undefined') note.sound = notification.sound;

            note.alert = notification.text;
            // Allow the user to set payload data
            note.payload = (notification.payload) ? { ejson: EJSON.stringify(notification.payload) } : {};

            note.payload.messageFrom = notification.from;
            note.priority = priority;

            // console.log('I:Send message to: ' + userToken + ' count=' + count);

            apnConnection.pushNotification(note, myDevice);

        };


        var initFeedback = function() {
            var apn = Npm.require('apn');
            // console.log('Init feedback');
            var feedbackOptions = {
                "batchFeedback": true,
                "interval": 1000,
                'address': 'feedback.push.apple.com'
            };

            var feedback = new apn.Feedback(feedbackOptions);
            feedback.on("feedback", function(devices) {
                devices.forEach(function(item) {
                    // Do something with item.device and item.time;
                    // console.log('A:PUSH FEEDBACK ' + item.device + ' - ' + item.time);
                    // The app is most likely removed from the device, we should
                    // remove the token
                    _removeToken({ apn: item.device});
                });
            });
        };

        // Init feedback from apn server
        // This will help keep the appCollection up-to-date, it will help update
        // and remove token from appCollection.
        initFeedback();

    } // EO ios notification

    if (options.gcm && options.gcm.apiKey) {
        if (Push.debug) console.log('GCM configured');
        //self.sendGCM = function(options.from, userTokens, options.title, options.text, options.badge, options.priority) {
        self.sendGCM = function(userTokens, notification) {
            // Make sure userTokens are an array of strings
            if (userTokens === ''+userTokens) userTokens = [userTokens];

            // Check if any tokens in there to send
            if (!userTokens.length) {
                if (Push.debug) console.log('sendGCM no push tokens found');
                return;
            }

            if (Push.debug) console.log('sendGCM', userTokens, notification);

            var gcm = Npm.require('node-gcm');
            var Fiber = Npm.require('fibers');

            // Allow user to set payload
            var data = (notification.payload) ? { ejson: EJSON.stringify(notification.payload) } : {};

            data.title = notification.title;
            data.message = notification.text;

            // Set extra details
            if (typeof notification.badge !== 'undefined') data.msgcnt = notification.badge;
            if (typeof notification.sound !== 'undefined') data.soundname = notification.sound;

            //var message = new gcm.Message();
            var message = new gcm.Message({
                collapseKey: notification.from,
            //    delayWhileIdle: true,
            //    timeToLive: 4,
            //    restricted_package_name: 'dk.gi2.app'
                data: data
            });

            if (Push.debug) console.log('Create GCM Sender using "' + options.gcm.apiKey + '"');
            var sender = new gcm.Sender(options.gcm.apiKey);

            _.each(userTokens, function(value, key) {
                if (Push.debug) console.log('A:Send message to: ' + value);
            });

            /*message.addData('title', title);
            message.addData('message', text);
            message.addData('msgcnt', '1');
            message.collapseKey = 'sitDrift';
            message.delayWhileIdle = true;
            message.timeToLive = 3;*/

            // /**
            //  * Parameters: message-literal, userTokens-array, No. of retries, callback-function
            //  */

            var userToken = (userTokens.length === 1)?userTokens[0]:null;

            sender.send(message, userTokens, 5, function (err, result) {
                if (err) {
                    if (Push.debug) console.log('ANDROID ERROR: result of sender: ' + result);
                } else {
                    if (Push.debug) console.log('ANDROID: Result of sender: ' + JSON.stringify(result));
                    if (result.canonical_ids === 1 && userToken) {

                        // This is an old device, token is replaced
                        Fiber(function(self) {
                            // Run in fiber
                            try {
                                self.callback(self.oldToken, self.newToken);
                            } catch(err) {

                            }

                        }).run({
                            oldToken: { gcm: userToken },
                            newToken: { gcm: result.results[0].registration_id },
                            callback: _replaceToken
                        });
                        //_replaceToken({ gcm: userToken }, { gcm: result.results[0].registration_id });

                    }
                    // We cant send to that token - might not be registred
                    // ask the user to remove the token from the list
                    if (result.failure !== 0 && userToken) {

                        // This is an old device, token is replaced
                        Fiber(function(self) {
                            // Run in fiber
                            try {
                                self.callback(self.token);
                            } catch(err) {

                            }

                        }).run({
                            token: { gcm: userToken },
                            callback: _removeToken
                        });
                        //_replaceToken({ gcm: userToken }, { gcm: result.results[0].registration_id });

                    }

                }
            });
            // /** Use the following line if you want to send the message without retries
            // sender.sendNoRetry(message, userTokens, function (result) {
            //     console.log('ANDROID: ' + JSON.stringify(result));
            // });
            // **/
        }; // EO sendAndroid

    } // EO Android

    // Universal send function
    var _querySend = function(query, options) {

      var countApn = [];
      var countGcm = [];

        Push.appCollection.find(query).forEach(function(app) {

          if (Push.debug) console.log('send to token', app.token);

            if (app.token.apn) {
              countApn.push(app._id);
                // Send to APN
                if (self.sendAPN) self.sendAPN(app.token.apn, options);

            } else if (app.token.gcm) {
              countGcm.push(app._id);

                // Send to GCM
                // We do support multiple here - so we should construct an array
                // and send it bulk - Investigate limit count of id's
                if (self.sendGCM) self.sendGCM(app.token.gcm, options);

            } else {
                throw new Error('Push.send got a faulty query');
            }

        });

        if (Push.debug) {

          console.log('Push: Sent message "' + options.title + '" to ' + countApn.length + ' ios apps ' + countGcm.length + ' android apps');

          // Add some verbosity about the send result, making sure the developer
          // understands what just happened.
          if (!countApn.length && !countGcm.length) {
            if (Push.appCollection.find().count() == 0) {
              console.log('Push, GUIDE: The "Push.appCollection" is empty - No clients have registred on the server yet...');
            }
          } else if (!countApn.length) {
            if (Push.appCollection.find({ 'token.apn': { $exists: true } }).count() == 0) {
              console.log('Push, GUIDE: The "Push.appCollection" - No APN clients have registred on the server yet...');
            }
          } else if (!countGcm.length) {
            if (Push.appCollection.find({ 'token.gcm': { $exists: true } }).count() == 0) {
              console.log('Push, GUIDE: The "Push.appCollection" - No GCM clients have registred on the server yet...');
            }
          }

        }

        return {
          apn: countApn,
          gcm: countGcm
        };
    };

    self.serverSend = function(options) {
      options = options || { badge: 0 };
      var query;

      // Check basic options
      if (options.from !== ''+options.from)
        throw new Error('Push.send: option "from" not a string');

      if (options.title !== ''+options.title)
        throw new Error('Push.send: option "title" not a string');

      if (options.text !== ''+options.text)
        throw new Error('Push.send: option "text" not a string');

      if (options.token || options.tokens) {

        // The user set one token or array of tokens
        var tokenList = (options.token)? [options.token] : options.tokens;

        if (Push.debug) console.log('Push: Send message "' + options.title + '" via token(s)', tokenList);

        query = {
          $or: [
              // XXX: Test this query: can we hand in a list of push tokens?
              { token: { $in: tokenList } },
              // XXX: Test this query: does this work on app id?
              { $and: [
                  { _in: { $in: tokenList } }, // one of the app ids
                  { $or: [
                      { 'token.apn': { $exists: true }  }, // got apn token
                      { 'token.gcm': { $exists: true }  }  // got gcm token
                  ]}
              ]}
          ]
        };

      } else if (options.query) {

        if (Push.debug) console.log('Push: Send message "' + options.title + '" via query', options.query);

        query = {
          $and: [
              options.query, // query object
              { $or: [
                  { 'token.apn': { $exists: true }  }, // got apn token
                  { 'token.gcm': { $exists: true }  }  // got gcm token
              ]}
          ]
        };
      }


      if (query) {

        // Convert to querySend and return status
        return _querySend(query, options)

      } else {
        throw new Error('Push.send: please set option "token"/"tokens" or "query"');
      }

    };

    var isSendingNotification = false;

    Meteor.setInterval(function() {

        if (!isSendingNotification) {
            // Set send fence
            isSendingNotification = true;

            // Find one notification
            var notification = Push.notifications.findOne({ sent : { $ne: true } }, { sort: { createdAt: 1 } });

            // Check if we got any notifications to send
            if (notification) {

                // Send the notification
                var result = Push.serverSend(notification);

                if (!options.keepNotifications) {
                    // Pr. Default we will remove notifications
                    Push.notifications.remove({ _id: notification._id });
                } else {

                    // Update the notification
                    Push.notifications.update({ _id: notification._id }, {
                        $set: {
                            sent: true,
                            sentAt: new Date(),
                            count: result
                        }
                    });

                }

                // Emit the send
                self.emit('send', { notification: notification._id, result: result });
            }

            // Remove the send fence
            isSendingNotification = false;
        }
    }, options.sendInterval || 15000); // Default every 15'the sec

};
