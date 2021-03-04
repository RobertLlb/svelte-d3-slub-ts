import { compact, orderBy } from 'lodash';
import { derived } from 'svelte/store';
import type { Person, ResourceAggResponse } from 'types/es';
import type { Topic, TopicMeta } from '../types/app';
import {
  topicRequest,
  authorRequest,
  topicRessourceAltNameRequest,
  topicRessourceExactAggregationRequest,
  topicRessourceAggregationRequest
} from './dataStore';

/**
 * The dataAPI combines the results of the DataStore and provides the UI components with data.
 */

/**
 * Replaces author references to persons with person objects
 *
 * @param aggs         ElasticSearch aggregation object
 * @param personList   List of persons
 */
function getPersons(aggs: ResourceAggResponse, personList: Person[]) {
  const persons = compact(
    aggs.aggregations.topAuthors.buckets.map((authorRef) => {
      const person = personList.find((p) => p['@id'] === authorRef.key);
      return person;
    })
  );

  return persons;
}

/**
 * Transforms ElasticSearch aggregation result to internal representation
 *
 * @param aggs ElasticSearch aggregation object
 */
function convertAggs(aggs: ResourceAggResponse) {
  const { hits, aggregations } = aggs;

  const meta: TopicMeta = {
    resourcesCount: hits.total.value,
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
    topicRequest,
    authorRequest,
    topicRessourceAltNameRequest,
    topicRessourceExactAggregationRequest,
    topicRessourceAggregationRequest
  ],
  async ([$topicResult, $authors, $altCounts, $aggMapStrict, $aggMapLoose]) => {
    // wait until all data is loaded
    const [
      topics,
      authors,
      altCounts,
      aggMapStrict,
      aggMapLoose
    ] = await Promise.all([
      $topicResult,
      $authors,
      $altCounts,
      $aggMapStrict,
      $aggMapLoose
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
      const aggStrict = aggMapStrict.get(preferredName);
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
        authors: aggStrict ? getPersons(aggStrict, authors) : []
      };

      return topic;
    });

    return merged;

    // return orderBy(merged, 'aggregations.resourcesCount', ['desc']);
  }
);
