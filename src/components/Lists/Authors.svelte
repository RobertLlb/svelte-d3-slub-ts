<script lang="ts">
  import { fade } from 'svelte/transition';
  import { authors, selectedTopic } from 'state/dataAPI';
  import { author } from 'state/uiState';
  import Tooltip from '../Tooltip.svelte';

  function handleClick(name) {
    if (name === $author) {
      author.set(null);
    } else {
      author.set(name);
    }
  }
</script>

{#if $selectedTopic?.count > 0}
  <h2>Top Autoren & Beteiligte</h2>
  {#if $author}
    <div class="filter" on:click={() => author.set(null)}>
      <span class="remove">X</span>
      {$author}
    </div>
    <hr />
  {/if}
  <ul>
    {#each $authors as { person, authorCount, contribCount } (person.id)}
      <li transition:fade>
        <Tooltip
          title={person.occupation.length > 0
            ? person.occupation.join(', ')
            : 'keine Berufsbezeichnung gefunden'}
          ><span on:click={() => handleClick(person.name)}
            >[{authorCount || '-'}/{contribCount || '-'}] {person.name}</span
          ></Tooltip
        >
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    padding: 0;
  }

  li:hover {
    background: rgba(255, 255, 255, 0.5);
  }

  .remove {
    font-weight: bold;
  }

  .filter:hover {
    cursor: pointer;
  }

  li {
    margin-bottom: 0.25rem;
    border-bottom: 1px solid lightgray;
    padding-bottom: 0.25rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
