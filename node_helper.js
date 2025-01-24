/* Magic Mirror
 * Module: MMM-NFL
 *
 * By jupadin
 * MIT Licensed.
 */

const NodeHelper = require('node_helper');
const Log = require('logger');

module.exports = NodeHelper.create({
    start: function() {
        this.config = null;
        this.updateInterval = null;
        this.seasonTypeMapping = {
            1: "PRE", // Pre-Season
            2: "REG", // Regular-Season
            3: "POST", // Post-Season
            4: "OFF", // Off-Season
        }
    },

    socketNotificationReceived: async function(notification, payload) {
        if (notification == "SET_CONFIG") {
            this.config = payload;
            this.updateInterval = this.config.updateInterval;

            // Retrieve data from NFL-Server
            this.getData();
        }
    },

    getGameStatus: function(eventStatus) {
        if (eventStatus.type.state == 'pre') {
            // Upcoming
            return "P";
        } else if (eventStatus.type.name === "STATUS_HALFTIME") {
            // Halftime
            return "H";
        } else if (eventStatus.type.name === "STATUS_POSTPONED") {
            // Postponed
            return "PP";
        } else if (eventStatus.type.state === "post") {
            return eventStatus.period > 4 ? "FO" : "F";
        } else if (eventStatus.period > 4) {
            // Game is still running -> Overtime
            return "OT";
        }
        return eventStatus.period;
    },

    mapEvent: function(event) {
        const ongoing = !['pre', 'post'].includes(event.status?.type?.state);
        const remainingTime = ongoing && event.status?.displayClock;

        const possessionTeamId = event.competitions?.[0]?.situation?.possession;
        const posessionTeam = event.competitions?.[0]?.competitors?.find(c => c.id === possessionTeamId);

        let formattedEvent = {
            // Name home team
            h: event.competitions[0].competitors[0].team.abbreviation,
            // Score home team
            hs: event.competitions[0].competitors[0].score,
            // Game status (live, quarter, over, ...)
            q: this.getGameStatus(event.status),
            // Start date of match
            starttime: event.date,
            // Name team guest
            v: event.competitions[0].competitors[1].team.abbreviation,
            // Score team guest
            vs: event.competitions[0].competitors[1].score,
            // Remaining time
            k: remainingTime,
            // Link logo team home
            hl: event.competitions[0].competitors[0].team.logo,
            // Link logo team guest
            vl: event.competitions[0].competitors[1].team.logo,
            // Ball posession
            p: posessionTeam,
        };

        if (formattedEvent.h === "WSH") formattedEvent.h = "WAS";
        if (formattedEvent.v === "WSH") formattedEvent.v = "WAS";
        if (formattedEvent.h === "LAR") formattedEvent.h = "LA";
        if (formattedEvent.v === "LAR") formattedEvent.v = "LA";

        return formattedEvent;
    },

    getData: function() {
        Log.info(`${this.name}: Fetching data from NFL-Server...`);

        const self = this;
        const nflURLScoreboard = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
        const nflURLLeaders = "https://site.api.espn.com/apis/site/v3/sports/football/nfl/leaders";

        fetch(nflURLScoreboard, {})
        .then(response => {
            if (response.status != 200) {
                self.sendSocketNotification("ERROR", response.statusCode);
                throw `${this.name}: Error fetching NFL data with status code ${response.status}.`;
            }
            return response.json();
        })
        .then(data => {
            const details = {
                week: data?.week?.number,
                year: data?.season?.year,
                type: self.seasonTypeMapping[data?.season?.type] 
            }

            const events = data.events || [];

            // Format each event based on callback function (mapEvent) and sort it afterwards, based on start date (starttime).
            const scores = events.map(self.mapEvent.bind(self)).sort((a, b) => {
                return (a.starttime < b.starttime) ? -1 : ((a.starttime > b.starttime) ? 1 : 0);
            });

            // Check if there is currently a live match
            if (scores.some(e => e.q in ["1", "2", "3", "4", "H", "OT"])) {
                // If there is a match currently live, set update interval to 1 minute.
                self.updateInterval = self.config.updateIntervalLive;
            } else {
                // Otherwise set it to the specified update interval time.
                self.updateInterval = self.config.updateInterval;
            }

            // Send data to front-end
            self.sendSocketNotification("DATA", {games: scores, details: details});
            return;

        })
        .catch(error => {
            Log.error(`${this.name}: ${error}.`);
            return;
        })

        // Set timeout to continuously fetch new data from NFL-Server
        this.dataTimer = setTimeout(this.getData.bind(this), (this.config.updateInterval));
    },
});