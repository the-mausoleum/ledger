'use strict';

var fs = require('fs');
var path = require('path');
var osenv = require('osenv');
var mkdirp = require('mkdirp');
var sqlite3 = require('sqlite3').verbose();
var multiline = require('multiline');

var ERRORS = Object.freeze({
    EEXIST: 'EEXIST',
    SQLITE_CONSTRAINT: 'SQLITE_CONSTRAINT'
});

var configPath = path.join(osenv.home(), '.ledger') + '/config.json';
var dataPath = path.join(osenv.home(), '.ledger');

var db = new sqlite3.Database(dataPath + '/ledger.db');

var api = exports;

api.init = function (callback) {
    mkdirp(dataPath, function (err) {
        if (err) {
            if (err.code !== ERRORS.EEXIST) {
                throw err;
            }
        }

        db.run(multiline(function () {/*
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE,
                checkout TEXT,
                hours INTEGER,
                minutes INTEGER,
                seconds INTEGER
            );
        */}), function (err) {
            if (err) {
                throw err;
            }

            db.run(multiline(function () {/*
                CREATE TABLE IF NOT EXISTS records (
                    id INTEGER PRIMARY KEY,
                    project TEXT,
                    checkout TEXT,
                    checkin TEXT,
                    hours INTEGER,
                    minutes INTEGER,
                    seconds INTEGER
                );
            */}), function (err) {
                if (err) {
                    throw err;
                }

                callback();
            });
        });
    });
};

api.checkout = function () {
    var config = loadConfig();

    if (config.project === null) {
        console.log('You do not have a current project');

        return;
    }

    loadProject(config.project.name, function (project) {
        if (project.checkout !== null) {
            console.log('You already have ' + project.name + ' checked out.');

            return;
        }

        project.checkout = new Date().toISOString();

        updateProject(project, function () {
            console.log('Checkout ' + config.project.name + '.');
        });
    });
};

api.checkin = function () {
    var config = loadConfig();

    if (config.project === null) {
        console.log('You do not have a current project');

        return;
    }

    loadProject(config.project.name, function (project) {
        if (project.checkout === null) {
            console.log('You do not have a project checked out.');

            return;
        }

        var then = new Date(project.checkout);
        var now = new Date();

        var delta = now - then;

        var seconds = Math.floor(delta / 1000);

        var minutes = Math.floor(seconds / 60);
        seconds -= minutes * 60;

        var hours = Math.floor(minutes / 60);
        minutes -= hours * 60;

        var record = {
            checkout: then.toISOString(),
            checkin: now.toISOString(),
            project: config.project.name,
            time: {
                hours: hours,
                minutes: minutes,
                seconds: seconds
            }
        };

        addRecord(record, function () {
            project.checkout = null;
            project.hours += record.time.hours;
            project.minutes += record.time.minutes;
            project.seconds += record.time.seconds;

            minutes = Math.floor(project.seconds / 60);
            project.minutes += minutes;
            project.seconds -= minutes * 60;

            hours = Math.floor(project.minutes / 60);
            project.hours += hours;
            project.minutes -= hours * 60;

            updateProject(project, function () {
                console.log('Checkin ' + config.project.name + '.');
            });
        });
    });
};

api.createProject = function (name) {
    var config = loadConfig();

    addProject(name, function () {
        if (config.project === null) {
            config.project = {
                name: name
            };
        }

        fs.writeFile(configPath, JSON.stringify(config), function (err) {
            if (err) {
                throw err;
            }

            console.log('Created project: ' + name);
        });
    });
};

api.listProjects = function (callback) {
    loadProjects(function (projects) {
        callback(projects);
    });
};

api.changeProject = function (name) {
    var config = loadConfig();

    loadProject(name, function (project) {
        if (project === undefined) {
            console.log('Could not find project: ' + name);

            return;
        }

        config.project.name = project.name;

        fs.writeFile(configPath, JSON.stringify(config), function (err) {
            if (err) {
                throw err;
            }

            console.log('Switched to project: ' + name);
        });
    });
}

api.deleteProject = function (name) {
    var config = loadConfig();

    deleteProject(name, function () {
        console.log('Deleted project: ' + name);
    });
};

api.exportProject = function (name, format) {
    var config = loadConfig();

    loadRecords(name, function (records) {
        var csv = [];

        csv.push([
            'project',
            'checkout',
            'checkin',
            'hours',
            'minutes',
            'seconds'
        ]);

        for (var i = 0; i < records.length; i++) {
            csv.push([
                records[i].project,
                records[i].checkout,
                records[i].checkin,
                records[i].hours,
                records[i].minutes,
                records[i].seconds,
            ]);
        }

        var output = csv.map(function (row) {
            return row.join(',');
        }).join('\n');

        var outPath = path.join(osenv.home(), 'Desktop') + '/' + name + '-' + new Date().toISOString() + '.csv';

        fs.writeFile(outPath, output, function (err) {
            if (err) {
                throw err;
            }

            console.log('Saved ' + name + ' data to ' + outPath);
        });
    });
};


function loadConfig() {
    var config;

    try {
        config = require(configPath);
    } catch (e) {
        config = {
            project: null
        };

        fs.writeFile(configPath, JSON.stringify(config), function (err) {
            if (err) {
                throw err;
            }
        });
    } finally {
        return config;
    }
}

function addRecord(record, callback) {
    db.run(multiline(function () {/*
        INSERT INTO records (project, checkout, checkin, hours, minutes, seconds)
        VALUES ($project, $checkout, $checkin, $hours, $minutes, $seconds);
    */}), {
        $project: record.project,
        $checkout: record.checkout,
        $checkin: record.checkin,
        $hours: record.time.hours,
        $minutes: record.time.minutes,
        $seconds: record.time.seconds
    }, function (err) {
        if (err) {
            throw err;
        }

        callback();
    });
}

function loadRecords(project, callback) {
    db.all(multiline(function () {/*
        SELECT * FROM records
        WHERE project = $project;
    */}), {
        $project: project
    }, function (err, records) {
        if (err) {
            throw err;
        }

        if (typeof callback === typeof Function) {
            callback(records);
        }
    });
}

function addProject(name, callback) {
    db.run(multiline(function () {/*
        INSERT INTO projects (name, checkout, hours, minutes, seconds)
        VALUES ($name, NULL, 0, 0, 0);
    */}), {
        $name: name
    }, function (err) {
        if (err) {
            if (err.code === ERRORS.SQLITE_CONSTRAINT) {
                console.log('A project named "' + name + '" already exists');

                return;
            }

            throw err;
        }

        callback();
    });
}

function loadProjects(callback) {
    db.all(multiline(function () {/*
        SELECT * FROM projects;
    */}), function (err, projects) {
        if (err) {
            throw err;
        }

        if (typeof callback === typeof Function) {
            callback(projects);
        }
    });
}

function loadProject(name, callback) {
    db.get(multiline(function () {/*
        SELECT * FROM projects
        WHERE name = $name;
    */}), {
        $name: name
    }, function (err, project) {
        if (err) {
            throw err;
        }

        if (typeof callback === typeof Function) {
            callback(project);
        }
    });
}

function updateProject(project, callback) {
    db.run(multiline(function () {/*
        UPDATE projects
        SET checkout = $checkout,
            hours = $hours,
            minutes = $minutes,
            seconds = $seconds
        WHERE name = $name;
    */}), {
        $name: project.name,
        $checkout: project.checkout,
        $hours: project.hours,
        $minutes: project.minutes,
        $seconds: project.seconds
    }, function (err, project) {
        if (err) {
            throw err;
        }

        if (typeof callback === typeof Function) {
            callback(project);
        }
    });
}

function deleteProject(name, callback) {
    db.run(multiline(function () {/*
        DELETE FROM projects
        WHERE name = $name;
    */}), {
        $name: name
    }, function (err) {
        if (err) {
            throw err;
        }

        db.run(multiline(function () {/*
            DELETE FROM records
            WHERE project = $project;
        */}), {
            $project: name
        }, function (err) {
            if (err) {
                throw err;
            }

            if (typeof callback === typeof Function) {
                callback();
            }
        });
    });
}
