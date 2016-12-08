/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Slack bot built with Botkit.


~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/




if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var Botkit = require('./lib/Botkit.js');
var os = require('os');
var strava = require('strava-v3');

var controller = Botkit.slackbot({
    json_file_store: 'stravabot.data'
});

var bot = controller.spawn({
    token: process.env.token
}).startRTM();

//Lets require/import the HTTP module
var http = require('http');

var config = require('./config.json');

//We need a function which handles requests and send response
function handleRequest(request, response){
    var url = require("url");
    var parts = url.parse(request.url, true);
    if (parts.query.code && parts.query.state){
        postResponse(parts.query.code, parts.query.state);
        response.end('Thank you! You can close this page now.');
    } else {
        response.end('Sorry there is something wrong with your request.');
    }
}

//Create a server
var server = http.createServer(handleRequest);

function postResponse(code, userid){
    var request = require('request');

    request.post({url:'https://www.strava.com/oauth/token', form: {client_id: config.client_id, client_secret: config.client_secret, code: code}
        }, function(err,httpResponse,body){ 
        var data = JSON.parse(body);
        console.log("Token: " + data.access_token);
        console.log(body);
        controller.storage.users.get(userid, function(err, user) {
            if (!user) {
                user = {
                    id: userid,
                };
            }
            user.token = data.access_token;
            controller.storage.users.save(user, function(err, id) {
                console.log("Authorized user " + userid + " with token " + user.token);
                var message = {user: userid};
                bot.startPrivateConversation(message, function(err, conversation){
                    conversation.say('You are now authorized with Strava. Type _my strava_ to see what Strava knows about you.');
                });
            });
        });
    });
}

//Lets start our server
server.listen(config.port, function(){
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Server listening on: http://localhost:%s", config.port);
});

controller.hears('authorize', 'direct_message', function(bot, message){
    controller.storage.users.get(message.user, function(err, user) {
        if (user) {
            bot.reply(message, 'You are already authorized.');
        };
    });

    authorize(message);
});

function athleteSumActivities(token, days, result){
    strava.athlete.get({'access_token' : token}, function(err, athlete){
        var name = athlete.firstname + " " + athlete.lastname;
        var mtime = 0;
        var dist = 0;
        var elev = 0;
        var rides = 0;
        strava.athlete.listActivities({'access_token' : token, per_page : 200}, function(err, activities){
            for(var i = 0; i < activities.length; i++){
                var d = activities[i].start_date.split('T')[0].split('-');
                var date = new Date(d[0], d[1]-1, d[2]);
                var cmpDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

                if (date < cmpDate){
                    continue;
                }

                if (activities[i].type == 'Ride'){
                    rides += 1;
                    mtime += activities[i].moving_time;
                    dist += activities[i].distance;
                    elev += activities[i].total_elevation_gain;
                }
            }
            var data = {
                rides : rides,
                moving_time : mtime,
                distance : dist,
                elevation : elev
            };
            result(name, data);
        });
    });
}


controller.hears('list *([0-9]*)', 'direct_message,direct_mention,mention', function(bot, message){

    var days = config.default_days;
    if (message.match[1]){
        days = message.match[1];
    }

    controller.storage.users.all(function(err, user_data){
        var data = [];
        for (var u = 0; u < user_data.length; u++){
            var user = user_data[u];
            athleteSumActivities(user.token, days, function(name, activities){
                data.push({name : name, activities : activities});
                if (data.length == user_data.length) {
                    data.sort(function(a, b){
                        return b.activities.moving_time - a.activities.moving_time;
                    });
                    var info = 'Here is the toplist of riders (last ' + days + ' days):\n';
                    for (var i = 0; i < data.length; i++){
                        info += (i+1) + '. *' + data[i].name + '* - ' + 
                        formatTime(data[i].activities.moving_time) + ' - ' + 
                        data[i].activities.rides + ' rides - ' +
                        Math.round(data[i].activities.distance /1000)+ ' km\n';
                    }
                    bot.reply(message, info);
                }
            });
        }
    });
});

controller.hears('my strava', 'direct_message', function(bot, message){
    talkToUser(message, function(message, user){
        athleteInfo(message, user.token, function(message, info){
            bot.reply(message, info);
        });
    });
});

function authorize(message){
    var url = 'https://www.strava.com/oauth/authorize?client_id=' + config.client_id + 
    '&response_type=code&redirect_uri=' + config.server_url + '&state=' + message.user;
    bot.reply(message, 'Click this link to authorize with Strava: ' + url);
}

function talkToUser(message, say){
    controller.storage.users.get(message.user, function(err, user) {
        console.log(user);
        if (!user) {
            bot.reply(message, 'I don\'t know you. Please authorize with Strava');
            authorize(message);
        } else {
            say(message, user);
        }
    });
}

function athleteInfo(message, userid, say){
    console.log('userid: ' + userid);

    strava.athlete.get({'access_token' : userid}, function(err, athlete){
        var info = '';
        info += 'Strava says your name is ' + athlete.firstname + 
            " and that you have " + athlete.bikes.length + " bikes.\n\n";
        athlete.bikes.forEach(function(bike){
            info += "You\'ve ridden your *" + bike.name + "* " + Math.round(bike.distance / 1000) + " km\n";
        });
        say(message, info);
    });

    strava.athlete.listActivities({'access_token' : userid}, function(err, activities){
        var info = 'Your most recent rides:\n';
        for (var i = 0; i < Math.min(activities.length, 10); i++){
            var ride = activities[i];
            info += "- *" + ride.name + "* (" + Math.round(ride.distance / 1000) 
            + " km) lasted " + formatTime(ride.elapsed_time) + "\n";
        }
        say(message, info);
    });
}


function formatTime(uptime) {
    var hours = Math.floor(uptime / (60*60));
    var minutes = Math.floor(uptime / 60 - hours * 60);
    if (minutes < 10 && minutes > 0) {
        minutes = "0" + minutes;
    }
    if (minutes == 0) {
        minutes = "00";
    }

    return hours + ":" + minutes + " hours";
}
