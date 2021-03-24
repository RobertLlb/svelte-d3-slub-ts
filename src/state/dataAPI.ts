import { compact, last, uniqBy } from 'lodash';
import { derived } from 'svelte/store';
import type { ResourceAggResponse } from 'types/es';
import {
  GraphLink,
  GraphNode,
  ResourceAggregation,
  Topic,
  NodeType,
  LinkType
} from '../types/app';
import {
  topicSearchRequest,
  authorMGetRequest,
  resourcesAltMSearchRequest,
  resourcesExactMSearchRequest,
  resourcesLooseMSearchRequest,
  geoMGetRequest,
  topicsRelatedMGetRequest,
  eventsMGetRequest,
  topicRelationsSearchRequest
} from './dataStore';

/**
 * The dataAPI combines the results of the DataStore and provides the UI components with data.
 */

/**
 * Replaces references to entities of different indices with real entity objects
 *
 * @param aggs          ElasticSearch aggregation result
 * @param entityList    List of entity objects
 * @param aggName       Name of the aggregation
 */
function getEntities<T>(
  aggs: ResourceAggResponse,
  entityList: T[],
  aggName: string
): Map<T, number> {
  if (!aggs) return null;

  const entries: [T, number][] = compact(
    aggs.aggregations[aggName].buckets.map(({ key, doc_count }) => {
      const entity = entityList.find((p) => p['@id'] === key);
      if (!entity) return null;
      return [entity, doc_count];
    })
  );

  return new Map(entries);
}

/**
 * Transforms ElasticSearch aggregation result to internal representation
 *
 * @param aggs ElasticSearch aggregation object
 */
function convertAggs(aggs: ResourceAggResponse) {
  const { hits, aggregations } = aggs;

  const meta: ResourceAggregation = {
    docCount: hits.total.value,
    topAuthors: aggregations.topAuthors.buckets,
    datePublished: aggregations.datePublished.buckets.map(
      ({ key, key_as_string, doc_count }) => ({
        year: new Date(key).getFullYear(),
        count: doc_count
      })
    ),
    mentions: aggregations.mentions.buckets.map(({ key, doc_count }) => ({
      name: key,
      docCount: doc_count
    }))
  };

  return meta;
}

/** Combines results from topic search in topic index and associated resources in resource index */
export const topicsEnriched = derived(
  [
    topicSearchRequest,
    authorMGetRequest,
    resourcesAltMSearchRequest,
    resourcesExactMSearchRequest,
    resourcesLooseMSearchRequest,
    geoMGetRequest,
    topicsRelatedMGetRequest,
    eventsMGetRequest
  ],
  async ([
    $topicResult,
    $authors,
    $altCounts,
    $aggMapStrict,
    $aggMapLoose,
    $geo,
    $topicsRelated,
    $events
  ]) => {
    // wait until all data is loaded
    const [
      topics,
      authors,
      altCounts,
      aggMapStrict,
      aggMapLoose,
      geo,
      topicsRelated,
      events
    ] = await Promise.all([
      $topicResult,
      $authors,
      $altCounts,
      $aggMapStrict,
      $aggMapLoose,
      $geo,
      $topicsRelated,
      $events
    ]);

    // merge results
    const merged = topics.map(({ _id, _score, _source }) => {
      const {
        preferredName,
        additionalType,
        alternateName = [],
        description
      } = _source;

      // get aggregation results on resources index
      const aggStrict = aggMapStrict.get(_source['@id']);
      const aggLoose = aggMapLoose.get(preferredName);

      // TODO: preserve all alternateNames?
      const altName = alternateName?.[0];

      // create topic model
      const topic: Topic = {
        id: _id,
        score: _score,
        name: preferredName,
        alternateName: altName,
        // create additionalType model
        // TODO: replace references with topics
        additionalTypes: additionalType?.map(
          ({ name, description, ...rest }) => ({
            id: rest['@id'],
            name,
            description
          })
        ),
        description,
        aggregations: aggStrict ? convertAggs(aggStrict) : null,
        aggregationsLoose: aggLoose ? convertAggs(aggLoose) : null,
        altCount: altCounts.get(altName)?.hits.total.value,
        authors: getEntities(aggStrict, authors, 'topAuthors'),
        locations: getEntities(aggStrict, geo, 'mentions'),
        related: getEntities(aggStrict, topicsRelated, 'mentions'),
        events: getEntities(aggStrict, events, 'mentions')
      };

      return topic;
    });

    return merged;

    // return orderBy(merged, 'aggregations.resourcesCount', ['desc']);
  }
);

/**
 * Returns graph structure for the visualization
 */
export const graph = derived(
  [topicRelationsSearchRequest, topicsEnriched],
  async ([$relationsReq, $topicsReq]) => {
    const [relations, topics] = await Promise.all([$relationsReq, $topicsReq]);

    // console.log('-------- GENERATE GRAPH -------------');

    // console.log('topics', topics);
    // console.log('relations', relations);

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    let relatedTopicNames = [];

    // create nodes for all top-level topics and collect related topics
    topics.forEach((primaryTopic) => {
      const { name, aggregationsLoose, related } = primaryTopic;

      // create graph node
      const primaryNode: GraphNode = {
        id: name,
        count: aggregationsLoose?.docCount,
        doc: primaryTopic,
        type: NodeType.primary,
        text: name
      };

      // console.log('primary', primaryNode.id);

      nodes.push(primaryNode);

      const relNames = Array.from(related.keys()).map((r) => r.preferredName);

      // collect related topics to create these topics later,
      // so that we can give precedence to top-level topics
      relatedTopicNames = [...relatedTopicNames, ...relNames];

      // create links from top-level topics to related topics
      related.forEach((weight, relatedTopic) => {
        const link: GraphLink = {
          id: `${primaryNode.id}-${relatedTopic.preferredName}`,
          source: primaryNode.id,
          target: relatedTopic.preferredName,
          type: LinkType.MENTIONS_ID_LINK,
          // TODO: use proper metric
          weight
        };

        links.push(link);
      });
    });

    // create related topic nodes if they haven't been created on the top-level
    relatedTopicNames.forEach((relatedTopic) => {
      // check if node already exists
      const exists = nodes.find((x) => x.id === relatedTopic);

      if (!exists) {
        const secNode = {
          id: relatedTopic,
          // TODO: get counts for secondary topics
          count: null,
          // TODO: add topic document
          doc: null,
          type: NodeType.secondary,
          text: relatedTopic
        };

        // console.log('>> secondary', secNode.id);
        nodes.push(secNode);
      }
    });

    // TODO: only add relation if it does not already exist (from top-level to related)
    relations.forEach(({ key, doc_count }) => {
      const [source, target] = key.split('&');

      // target is undefined for cells ij with i == j
      if (target) {
        let sourceNode = nodes.find((x) => x.id === source);
        let targetNode = nodes.find((x) => x.id === target);

        // FIXME: this case should not happen
        if (!sourceNode) {
          nodes.push({
            id: source,
            count: null,
            doc: null,
            type: NodeType.secondary,
            text: source
          });

          // console.log(`.....creating source node "${source}" from relations`);
        }

        // FIXME: this case should not happen
        if (!targetNode) {
          nodes.push({
            id: target,
            count: null,
            doc: null,
            type: NodeType.secondary,
            text: target
          });

          // console.log(`.....creating target node "${target}" from relations`);
        }

        const link: GraphLink = {
          id: source + '-' + target,
          source,
          target,
          weight: doc_count,
          type: LinkType.MENTIONS_NAME_LINK
        };

        links.push(link);
      }
    });

    return { links: compact(links), nodes: uniqBy(nodes, 'id') };
  }
);
