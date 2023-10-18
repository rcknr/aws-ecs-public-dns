// TODO:
// + Test new code
// + Check if multiple IPs are possible (yes!) but not practical
// + Tag the service with the domain
// + Make sure subdomain does not exceed max length (63)
// + Make domain tag optional
// - Add Github Action (check process.env.GITHUB_ACTIONS)
// Event reference: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_cwe_events.html
// arn:aws:ecs:eu-central-1:636800907403:service/staging-previews/I_could_not_possibly_love_anything_in_the_world_more_than_I_love_my_dog

const AWS= require("aws-sdk");

const ec2 = new AWS.EC2();
const ecs = new AWS.ECS();
const route53 = new AWS.Route53();

/**
 * Upsert a public ip DNS record for the incoming task.
 *
 * @param event contains the task in the 'detail' propery
 */
exports.handler = async event => {
    console.log('Received event: %j', event);

    const task = event.detail;
    const clusterArn = task.clusterArn;
    const clusterName = clusterArn.split(':cluster/').pop();
    const tags = await fetchClusterTags(clusterArn)
    const hostedZoneId = tags['hostedZoneId']
    let domain = tags['domain']

    if (!hostedZoneId) {
        console.log(`Skipping. Reason: no "hostedZoneId" tag found for cluster ${clusterArn}`);
        return;
    }

    const hostedZoneDomain = await getHostedZoneDomain(hostedZoneId);

    if (!domain || !domain.endsWith(hostedZoneDomain)) {
        console.log(`No "domain" tag found or does not match with hosted zone ${hostedZoneId}`);
        domain = hostedZoneDomain;
    }

    console.log(`cluster: ${clusterName}, domain: ${domain}, hostedZone: ${hostedZoneId}`)

    const serviceName = task.group.split(":").pop();
    const serviceArn = `${clusterArn.replace(':cluster', ':service')}/${serviceName}`;
    const serviceSlug = normalizeName(serviceName);
    const serviceDomain = `${serviceSlug}.${domain}`;

    const publicIps = await ecs.listTasks({cluster: clusterName, serviceName}).promise()
        .then(async ({taskArns: tasks}) => {
            return tasks.length ? (await ecs.describeTasks({cluster: clusterName, tasks}).promise()).tasks : [];
        })
        .then(async (tasks) => {
            return await fetchEniPublicIps(tasks.map(getEniId));
        });

    if (publicIps.length) {
        console.log(`service: ${serviceName}, public IP: ${publicIps.join(', ')}`)

        const recordSet = createRecordSet(serviceDomain, publicIps);
        const recordComment = `Auto generated Record for ECS Fargate cluster ${clusterName}`;

        await updateDnsRecord(hostedZoneId, recordSet, recordComment)
        console.log(`DNS record update finished for ${serviceDomain} (${publicIps.join(', ')})`)

        await updateTags(serviceArn, { domain: serviceDomain });
        console.log('Service is tagged with domain name.')
    } else {
        const recordSet = await getDnsRecord(hostedZoneId, serviceDomain);

        if (recordSet) {
            await updateDnsRecord(hostedZoneId, deleteRecordSet(recordSet));
            console.log(`DNS record is removed for ${serviceDomain}`)

            await updateTags(serviceArn, { domain: null });
            console.log(`A domain tag is removed.`)
        }
    }
};

async function fetchClusterTags(clusterArn) {
    const response = await ecs.listTagsForResource({
        resourceArn: clusterArn
    }).promise();

    return response.tags.reduce((hash, tag) => {
        return Object.assign(hash, {
                [tag.key]: tag.value
            });
        }, {});
}

async function getHostedZoneDomain(Id) {
    const hostedZone = await route53.getHostedZone({ Id }).promise();

    return hostedZone?.HostedZone.Name.replace(/\.$/, '');
}

function normalizeName(serviceName) {
    return serviceName.toLowerCase()
        .replace(/_/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 63)
        .replace(/-*$/, '');
}

function getEniId(task) {
    return task.attachments
        .find(attachment => ['eni', 'ElasticNetworkInterface'].includes(attachment.type))
        ?.details.find(detail => detail.name === 'networkInterfaceId')
        ?.value;
}

async function fetchEniPublicIps(eniIds) {
    const NetworkInterfaceIds = [eniIds].flat();

    if (!NetworkInterfaceIds.length) return [];

    const data = await ec2.describeNetworkInterfaces({ NetworkInterfaceIds }).promise();

    return data.NetworkInterfaces.map(NetworkInterface => NetworkInterface?.Association?.PublicIp);
}

function createRecordSet(domain, publicIps) {
    return {
        "Action": "UPSERT",
        "ResourceRecordSet": {
            "Name": domain,
            "Type": "A",
            "TTL": 180,
            "ResourceRecords": [publicIps].flat().map(ip => ({ Value: ip }))
        }
    };
}

function deleteRecordSet(ResourceRecordSet) {
    return {
        "Action": "DELETE",
        ResourceRecordSet
    };
}

async function getDnsRecord(HostedZoneId, StartRecordName, StartRecordType = "A") {
    const data = await route53.listResourceRecordSets({
        HostedZoneId,
        StartRecordName,
        StartRecordType
    }).promise();

    return data?.ResourceRecordSets?.shift();
}

async function updateDnsRecord(hostedZoneId, changeRecordSet, comment = "") {
    let param = {
        ChangeBatch: {
            "Comment": comment,
            "Changes": [changeRecordSet]
        },
        HostedZoneId: hostedZoneId
    };
    const updateResult = await route53.changeResourceRecordSets(param).promise();
    console.log('Updating DNS records result: %j %j', param, updateResult);
}

async function updateTags(resourceArn, tags) {
    const to = Object.entries(tags).reduce((result, [key, value]) => {
        if (value) {
            result.add.push({ key, value });
        } else {
            result.remove.push(key);
        }

        return result;
    }, { add: [], remove: [] });

    if (to.add.length) {
        await ecs.tagResource({ resourceArn, tags: to.add }).promise();
    }

    if (to.remove.length) {
        await ecs.untagResource({ resourceArn, tagKeys: to.remove }).promise();
    }
}
