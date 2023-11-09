const { EC2, DescribeNetworkInterfacesCommand } = require('@aws-sdk/client-ec2');
const { ECS, DescribeTasksCommand, ListTagsForResourceCommand, ListTasksCommand, TagResourceCommand } = require('@aws-sdk/client-ecs');
const { Route53, GetHostedZoneCommand, ChangeResourceRecordSetsCommand } = require('@aws-sdk/client-route-53')
const { mockClient } = require('aws-sdk-client-mock');
require('aws-sdk-client-mock-jest');

const { handler } = require('../src/function.js')

const ec2Mock = mockClient(EC2);
const ecsMock = mockClient(ECS);
const route53Mock = mockClient(Route53);

test('function works', async () => {

    const domain = 'example.com'

    route53Mock.on(GetHostedZoneCommand).resolves({
        HostedZone: {
            Name: `${domain}.`
        }
    });

    ecsMock.on(ListTagsForResourceCommand).resolves({
        tags: [{
            key: 'hostedZoneId',
            value: 'hostedZoneId'
        }, {
            key: 'domain',
            value: domain
        }]
    });

    ecsMock.on(ListTasksCommand).resolves({
        taskArns: ['123']
    });

    ecsMock.on(DescribeTasksCommand).resolves({
        tasks: [{
            attachments: [{
                type: 'ElasticNetworkInterface',
                details: [{
                    name: 'networkInterfaceId',
                    value: 'eniId'
                }]
            }]
        }]
    });

    ec2Mock.on(DescribeNetworkInterfacesCommand).resolves({
        NetworkInterfaces: [{
            Association: {
                PublicIp: '0.0.0.0'
            }
        }]
    })

    const event = {
        detail: {
            clusterArn: 'arn:aws:ecs:us-east-1:111122223333:cluster/default',
            group: 'family:sample-fargate'
        }
    }

    await handler(event)

    expect(route53Mock).toHaveReceivedCommand(ChangeResourceRecordSetsCommand);
    expect(ecsMock).toHaveReceivedCommand(TagResourceCommand);

})