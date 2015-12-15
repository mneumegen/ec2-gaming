var AWS = require('aws-sdk'),
  fs = require('fs'),
  async = require("async"),
  child_process = require('child_process'),
  colors = require('colors'),
  config = "",
  spotImageId = null,
  readConfig = function(callback) {
    checkConfigExists(function(err) {
      if (err) {
        return callback(err);
      }

        fs.readFile("config.json", "utf-8",  function read(err, data) {
          if (err) {
            return callback(err);
          }

          config =  JSON.parse(data);

          validateAWSValues(callback);
        });
    });
  },

  checkConfigExists = function(callback) {
    fs.exists('config.json', function(exists) {
      if (!exists) {
        return copyConfig(callback);
      }

      callback();
    });
  },

  copyConfig = function(callback) {
    fs.readFile("templates/config.json", "utf-8",  function read(err, data) {
      if (err) {
        return callback(err);
      }

      fs.writeFile("config.json", data,  function read(err, data) {
        callback(err);
      });
    });
  },

  validateAWSValues = function(callback) {

    if (! (config.accessKeyId && config.secretAccessKey && config.region)) {
      return callback("AWS credentials not set in config.json");
    }

    callback();
  },

  setupAws = function(callback) {
    AWS.config.update(config);
    callback();
  },

  setupSecurityGroup = function(callback) {
    new AWS.EC2().describeSecurityGroups({ GroupNames: [config.securityGroupName]}, function(err, data) {
      if (err) {
        if (err.code == "InvalidGroup.NotFound") {
          return createSecurityGroup(callback);
        } else {
          return callback(err);
        }
      }

      callback();
    });
  },

  createSecurityGroup = function(callback) {
    var params = {
      Description: 'Security Group for EC2-Gaming Images',
      GroupName: config.securityGroupName
    };

    console.log("Creating EC2 Security Group");

    new AWS.EC2().createSecurityGroup(params, function(err, data) {
      if (err) {
        return callback(err);
      }

      createSecurityRules(data.GroupId, callback);
    });
  },

  createSecurityRules = function(groupId, callback) {
    var params = {
      GroupId: groupId,
      IpPermissions: [
        {
          FromPort: 0,
          IpProtocol: 'tcp',
          ToPort: 65535,
          IpRanges: [{
            CidrIp: '0.0.0.0/0'
          }],
        },
        {
          FromPort: 0,
          IpProtocol: 'udp',
          ToPort: 65535,
          IpRanges: [{
            CidrIp: '0.0.0.0/0'
          }],
        }
      ],
    };

    new AWS.EC2().authorizeSecurityGroupIngress(params, function(err, data) {
      if (err) {
        return callback(err);
      }

      callback();
    });
  },

  setupSpotRequest = function(callback) {
    if (config.useSpotImage) {
      var params = {
        SpotPrice: config.spotPrice,
        BlockDurationMinutes: config.spotDuration,
        LaunchSpecification: {
          ImageId: config.imageId,
          InstanceType: config.instanceType,
          SecurityGroups: [config.securityGroupName]
        },
      };

      console.log("Setting up spot request");
      new AWS.EC2().requestSpotInstances(params, function(err, data) {
        if (err) {
          return callback(err);
        }
        spotImageId = data.SpotInstanceRequests[0].SpotInstanceRequestId;
        console.log("Monitoring spot request");
        monitorSpotRequest(spotImageId, callback);
      });
    } else {
      setupInstance(callback);
    }
  },

  monitorSpotRequest = function(spotId, callback) {

    checkSpotRequest(spotId, function(err, instanceId) {
      if (err) {
        return callback(err);
      }

      if (instanceId) {
        monitorInstanceStartUp(instanceId, callback);
      } else {
        setTimeout(function() {
          monitorSpotRequest(spotId, callback);
        }, 1000);
      }
    });
  },

  checkSpotRequest = function(spotId, callback) {
    var params = {
      SpotInstanceRequestIds: [
        spotId
      ]
    };

    new AWS.EC2().describeSpotInstanceRequests(params, function(err, data) {
      if (err) {
        return callback(err);
      }

      var spotRequest = data.SpotInstanceRequests[0],
        state = spotRequest.State,
        status = spotRequest.Status;

      if (['open', 'active'].indexOf(state) > -1) {
        if (state == 'active' && status.Code == 'fulfilled') {
          return callback(null, spotRequest.InstanceId);

        } else if (! (status.Code == "pending-evaluation" || status.Code == "pending-fulfillment")) {
          deleteSpotRequest(spotRequest.SpotInstanceRequestId, function(err, data) {
            if (err) {
              return callback(err);
            }
            console.log("Cancelled spot request");
            return callback(status.Code);
          });

        } else {
          callback();
        }
      } else {
        return callback(err);
      }
    });
  },

  deleteSpotRequest = function(spotId, callback) {
    var params = {
      SpotInstanceRequestIds: [spotId],
    };

    new AWS.EC2().cancelSpotInstanceRequests(params, callback);
  },

  setupInstance = function(callback) {
    var params = {
      ImageId: config.imageId,
      InstanceType: config.instanceType,
      MinCount: 1, MaxCount: 1,
      SecurityGroupIds: [config.securityGroupName]
    };

    new AWS.EC2().runInstances(params, function(err, data) {
      if (err) {
        return callback(err);
      }

      var instanceId = data.Instances[0].InstanceId;
      console.log("Created instance", instanceId);

      monitorInstanceStartUp(instanceId, callback);

    });
  },

  monitorInstanceStartUp = function(instanceId, callback) {

    console.log("Monitoring instance start up");
    console.log("This can take a few minutes");
    var count = 0,
    monitorer = setInterval(function() {
      new AWS.EC2().describeInstanceStatus({ InstanceIds: [instanceId] }, function(err, data) {
        if (err) {
          clearInterval(monitorer);
          return callback(err);
        }

        if (checkRunning(data)) {
          clearInterval(monitorer);

          callback(null, instanceId);
          return;
        }

        count++;

        if (count > 500) {
          clearInterval(monitorer);
          return callback("ec2 not running");
        }
      });
    }, 5000);
  },

  checkRunning = function(data) {
    if (data.InstanceStatuses.length > 0) {
      var status = data.InstanceStatuses[0];

      return status.InstanceState.Name == "running" && status.SystemStatus.Status == "ok" && status.InstanceStatus.Status == "ok";
    }

    return false;
  },

  getPublicIp = function(instanceId, callback) {
    new AWS.EC2().describeInstances({ InstanceIds: [instanceId] }, function(err, data) {
      if (err) {
        return callback(err);
      }

      callback(null, data.Reservations[0].Instances[0].PublicIpAddress);
    });
  },

  terminateInstance = function(instanceId, callback) {
    new AWS.EC2().terminateInstances({ InstanceIds: [instanceId]}, callback);
  },

  openRdp = function(ip, callback) {
    console.log("Step 2: Connect via RDP".underline.green);

    if (config.useRDPLink) {
      var rdpLink = 'rdp://' + config.username + ':' + config.password + '@' + ip;
      child_process.spawn('open', [rdpLink]);
      console.log("Opened RDP link: ", rdpLink);
    } else {
      console.log("Enter these settings into your RDP program:");
      console.log("IP:", ip);
      console.log("Username: ", config.username);
      console.log("Password: ", config.password);
    }
    callback();
  },

  generateOpenVpnFiles = function(ip, callback) {
    console.log("Step 3: Generate OpenVpn Files".underline.green);
    generateConfigFile("client.ovpn", ip, callback);
  },

  generateConfigFile = function(name, ip, callback) {
    fs.readFile("templates/" + name, "utf-8",  function read(err, data) {
      if (err) {
        return callback(err);
      }

      if (ip) {
        data = data.replace("##ip##", ip);
      }


      writeConfigFile(name, data, callback);
    });
  },

  writeConfigFile = function(name, data, callback) {
    fs.writeFile("openvpn/" + name, data, function(err, data) {
      console.log("Writing config file written to openvpn/" + name);
      return callback(err);
    });
  },

  handleShutdown = function(instanceId, callback) {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    console.log("The instance is now running...".green);
    console.log("When you're finished, either type:");
    console.log("1 - To shutdown the instance or");
    console.log("2 - To leave the instance running");

    process.stdin.on('data', function (chunk) {
      chunk = chunk.replace(/\n|\r/g, "");
      if (chunk == "1") {
        console.log("Shutting down " + instanceId);

        if (spotImageId === null) {
          terminateInstance(instanceId, function(err, data) {
            process.stdin.pause();
            callback(err, data);
          });
        } else {
          deleteSpotRequest(spotImageId, function(err, res) {
            if (err) {
              callback(err);
              return;
            }

            terminateInstance(instanceId, function(err, data) {
              process.stdin.pause();
              callback(err, data);
            });
          });
        }
      } else if (chunk == "2") {
        process.stdin.pause();
        callback();
      }
    });
  },

  finished = function() {
    console.log("All finished");
  };

console.log("Step 1: Start Instance".underline.green);
async.series([
    readConfig,
    setupAws,
    setupSecurityGroup,
    setupSpotRequest
], function(err, res) {
  if (err) {
    console.log("Errors: ", err);
    return;
  }

  var instanceId = res[res.length - 1];

  getPublicIp(instanceId, function(err, ip) {
    console.log("Instance started with IP of ", ip);
    async.series([
      function(callback) {
        openRdp(ip, callback);
      },
      function(callback) {
        generateOpenVpnFiles(ip, callback);
      }
    ], function(err, res) {
      if (err) {
        console.log("Errors: ", err);
        return;
      }

      handleShutdown(instanceId, function(err, res) {
        if (err) {
          console.log("Errors: ", err);
          return;
        }

        finished();
      });
    });
  });
});
