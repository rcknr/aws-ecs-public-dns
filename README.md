# Automatic public DNS for Fargate-managed containers in Amazon ECS

## Problem definition
Fargate-managed containers in ECS can have a public IP address but lack built-in support for registering services into public DNS namespaces.
This is an event-driven approach to automatically register the public IP of a deployed service/task in a Route 53 hosted zone.

See [this blog post](https://medium.com/@andreas.pasch/automatic-public-dns-for-fargate-managed-containers-in-amazon-ecs-f0ca0a0334b5) for more information.

## How it works

A lambda function subscribes to an "ECS Task State Change" event. It gets called whenever a container has started up. What the function does is :

* fetching the public IP from the container
* construct a subdomain for the container
* register the public IP for the subdomain in Route 53

## Installation

First you need to pull dependencies using:

`npm install`

Deploy the function in your active AWS account:

```
npm run deploy
```

Alternatively, use a profile:

```
npm run deploy -- --aws-profile profile1
```

In your ECS console, select your cluster and add the tags

* hostedZoneId (the hosted zone id of your public DNS namespace, for example `Z1OAI7EUAR14MP`)
* domain (the domain name of your public DNS namespace, for example `foby.org`). You can use this as a template to add prefixes, for example `test.foby.org`.

## Demo

Well, just start a Fargate task in your cluster. When the task has started up, the function creates an A-record-set in your hosted zone with the containers' service name as subdomain.

