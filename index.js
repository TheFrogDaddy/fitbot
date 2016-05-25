#!/usr/bin/env nodejs

const util = require('util');
const strava = require('strava-v3');
const _ = require('lodash');
const winston = require('winston');
const request = require('request');

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({
      colorize: true,
    }),
    new (winston.transports.File)({
      filename: 'fitbot.log',
      json: false,
    }),
  ],
});

try {
  const config = require('./config');
}
catch (e) {
  logger.error(e);
  process.exit(1);
}

var lastActivityCheck = Date.now();

const VERBS = {
  'Ride': 'rode',
  'Run': 'ran',
};

const EMOJI = {
  'Ride': ':bike:',
  'Run': ':runner:',
};

function checkForNewActivities() {
  config.strava_clubs.forEach(function(club) {
    strava.clubs.listActivities({
      access_token: config.strava_token,
      id: club.id,
    }, function(error, activities) {
      postActivitiesToSlack(error, club, activities);
    });
  });
};

function postActivitiesToSlack(error, club, activities) {
  if (error) {
    logger.error(error);
    return;
  } else if (!activities || !activities.length) {
    logger.info(util.format('No activities found for %s.', club.id));
    return;
  }

  // Filter to new activities.
  activities = _.filter(activities, function(activity) {
    return Date.parse(activity.start_date) > lastActivityCheck;
  });

  // Sort activities by start_date descending.
  activities = _.sortBy(activities, 'start_date').reverse()

  logger.info(util.format('Found %d new activities for %s.', activities.length, club.id));

  // Post activities to Slack.
  activities.forEach(function(activity) {
    const message = formatActivity(activity);
    postMessageToSlack(club, message);
  });

  lastActivityCheck = Date.now();
}

function postMessageToSlack(club, message) {
  request.post({
    url: club.webhook,
    method: 'POST',
    json: true,
    body: {
      username: config.slack_name,
      icon_url: config.slack_icon,
      text: message,
    },
  }, function(error) {
    if (error) {
      logger.error(error);
    }
    else {
      logger.info(util.format('Posted to slack: %s', message));
    }
  });
}

function formatActivity(activity) {
  const message = '%s just %s %d miles! %s %s %s %s';

  const emoji = EMOJI[activity.type];
  const who = util.format('%s %s', activity.athlete.firstname, activity.athlete.lastname);
  const link = util.format('<https://www.strava.com/activities/%d>', activity.id);
  const distance = Math.round((activity.distance * 0.00062137) * 100) / 100;
  const verb = VERBS[activity.type] || activity.type;

  return util.format(message, who, verb, distance, emoji, activity.name, emoji, link);
}

checkForNewActivities();

setInterval(checkForNewActivities, config.activity_check_interval);
