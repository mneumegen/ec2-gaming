# EC2 Gaming Script

This Node.js script automates a number of steps in Larry Gadea's guide on [how to set up a streaming gaming service on EC2](http://lg.io/2015/07/05/revised-and-much-faster-run-your-own-highend-cloud-gaming-service-on-ec2.html).

I've only tested this on OS X but it should work on other operating systems with some minor tweaks.

## What does it do?

With this script you can get in-game with minimal effort.

There's three phases to starting a gaming instance:

1. Set up AWS with the right security group and start the EC2 instance.
2. Print out details for accessing the instance using a remote desktop client to login into steam.
3. Output configurations files to connect to the VPN via [TunnelBlink](https://tunnelblick.net/)

## Setup

[Install node.js](http://coolestguidesontheplanet.com/installing-node-js-on-osx-10-10-yosemite/) if it's not already on your machine.

We'll also need Remote Desktop software. I recommend [CoRD](http://cord.sourceforge.net/) as this script can automate the configuration for CoRD if you turn on the `useRDPLink` option in `config.json`.

For our VPN client, download [TunnelBlink](https://tunnelblick.net/).

Finally, download this script to your computer and run

```npm install```

## Run

To start a new gaming session run

```node index.js```

The first time you run this it will complain about not having any AWS credentials. Log in to AWS and add these to config.json. To find your closest AWS region check out [cloudping](http://www.cloudping.info/)

Now when you run the script, it will start up a Windows instance and print out the instance-id and IP address.

On to step two, it will print out details for logging in via RDP. Enter these into your Remote Desktop Software. Once you've logged in it will ask you to change your password, enter a new password and it'll open up the desktop with steam. Login to steam, go to Preferences -> In-Home Sharing Streaming and ensure the enable streaming checkbox is enabled. Then click the logout shortcut on the desktop.

Step three, in this scripts directory, there's a openVNP directory. Open this and there'll be two files. Open `client.ovpn` with TunnelBlink. You'll have to enter a username and password. The username is Administrator, the password is what you set in the previous step.

Now we're ready to go! Open up steam on your local computer. Once again, go to Preferences -> In-Home Sharing Streaming and ensure the enable streaming checkbox is enabled. Now you should see the remote computer appear.

When you're finished gaming you can press 1 to stop the instance and exit or 2 to keep the instance running and quit.

## Configuration

* **useRDPLink**: If true, instead of displaying instructions for an RDP it will open a fully configured RDP link. Works with [CoRD](http://cord.sourceforge.net/)
* **useSpotImage**: Whether to use a spot image or normal instance
* **securityGroupName**: The name of the AWS security group
* **spotPrice**: The maximum spot pricing to pay
* **spotDuration**: The maximum duration an instance is active (safeguard incase you forget to turn it off)
* **instanceType**: The type of EC2 instance
* **imageId**: The base image for the instance
* **username**: Username for accessing the server
* **password**: Password for accessing the server
* **accessKeyId**: AWS Access key
* **secretAccessKey**: AWS Secret key
* **region**: AWS Region
