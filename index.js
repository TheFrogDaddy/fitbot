#!/usr/bin/env nodejs

const util = require('util');
const strava = require('strava-v3');
const _ = require('lodash');
const request = require('request');
const duration = require('humanize-duration');

const logger = require('./lib/logger');
const db = require('./lib/db');
const config = require('./lib/config');

const VERBS = {
  'Ride': 'rode',
  'Run': 'ran',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
  'Swim': ':swimmer:',
};

const MESSAGE_FORMAT = `{
    "attachments": [
        {
            "fallback": "Required plain-text summary of the attachment.",
            "color": "",
            "pretext": "",
            "author_name": "%s",
            "author_link": "%s",
            "author_icon": "%s",
            "title": "%s",
            "title_link": "%s",
            "text": "%s",
            "fields": [
                {
                    "title": "Distance",
                    "value": "%smi",
                    "short": true
                },
				        {
                    "title": "Time",
                    "value": "%s",
                    "short": true
                },
				        {
                    "title": "Pace",
                    "value": "%s",
                    "short": true
                },
                {
                    "title": "Elevation",
                    "value": "%dft",
                    "short": true
                }
            ],
            "image_url": "%s",
            "thumb_url": "%s",
            "footer": "",
            "footer_icon": "",
            "ts": ""
        }
    ]
}`;

function checkForNewActivities(initial) {
  initial = !!initial

  config.strava_clubs.forEach(function(club) {
    strava.clubs.listActivities({
      access_token: config.strava_token,
      per_page: 200,
      id: club.id,
    }, function(error, activities) {
      if (error) {
        logger.error('Error listing activities', {error: error, club: club});
      }
      else if (!activities || !activities.length) {
        logger.info('No activities found', {response: activities, club: club.id});
      }
      else {
        // Filter out activities we've already seen.
        const newActivities = activities.filter(function(activity) {
          return !db.get('activities').find({id: activity.id}).value();
        });

        logger.info('Checked for activities', {count: newActivities.length, club: club.id, initial: initial});

        const SEVEN_DAYS_AGO = new Date().getTime() - 1000 * 60 * 60 * 24 * 7;

        if (!initial) {
          newActivities.forEach(function(summary) {
            const startDate = new Date(summary.start_date);

            if (summary.type === 'Bike' && summary.commute) {
              logger.info('Not posting to slack because it\'s a bike commute', {activity: summary.id, club: club.id});
            }
            else if (startDate.getTime() <= SEVEN_DAYS_AGO) {
              logger.info('Not posting to slack because it\'s old', {
                activity: summary.id,
                club: club.id,
                start_date: summary.start_date,
              });
            }
            else {
              strava.activities.get({
                access_token: config.strava_token,
                id: summary.id
              }, function(error, activity) {
                if (error) {
                  logger.error('Error fetching activity details', {error: error, activity: summary});
                } else {
                  postActivityToSlack(club.webhook, summary.athlete, activity);
                }
              });
            }
          });
        }

        newActivities.forEach(function(activity) {
          db.get('activities').push({id: activity.id}).write();
        });
      }
    });
  });
};

function postActivityToSlack(webhook, athlete, activity) {
  var message = formatActivity(athlete, activity);

  request.post({
    url: webhook,
    method: 'POST',
    json: true,
    body: JSON.parse(message),
  }, function(error) {
    if (error) {
      logger.error('Error posting message to Slack', {
        webhook: webhook,
        error: error,
        activity: activity,
      });
    }
    else {
      logger.info(util.format('Posted to slack: %s', message));
    }
  });
}

function formatActivity(athlete, activity) {

  const who = util.format('%s %s', athlete.firstname, athlete.lastname);
  const profile_link = util.format('https://www.strava.com/athletes/%d', athlete.id);
  const activity_link = util.format('https://www.strava.com/activities/%d', activity.id);
  const distance = Math.round((activity.distance * 0.00062137) * 100) / 100;
  const time = duration(activity.elapsed_time * 1000);
  const pace = util.format('%s:%s/mi',
                           Math.floor(((activity.moving_time / 60) /  distance )),
                           Math.round((((activity.moving_time / 60) / distance ) % 1 ) * 60));
  const elevation = activity.total_elevation_gain;
  const verb = VERBS[activity.type] || activity.type;
  const title = util.format("%s %s %d miles!", athlete.firstname, verb, distance)

  return util.format(MESSAGE_FORMAT,
                    who,
                    profile_link,
                    athlete.profile_medium,
                    title,
                    activity_link,
                    activity.name,
                    distance, 
                    time,
                    pace,
                    elevation);
}

checkForNewActivities(true);

setInterval(checkForNewActivities, config.activity_check_interval);
