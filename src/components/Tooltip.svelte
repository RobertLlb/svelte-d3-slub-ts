<script lang="ts">
  import { fade } from 'svelte/transition';

  export let title = '';
  let show = false;
  let x = 0;
  let y = 0;

  function handleMouseOver(e) {
    show = true;
    x = Math.max(e.pageX, 200);
    y = e.pageY - 32;
  }

  function handleMouseMove(e) {}

  function handleMouseLeave() {
    show = false;
  }
</script>

<div
  class="wrapper"
  on:mouseover={handleMouseOver}
  on:mousemove={handleMouseMove}
  on:mouseleave={handleMouseLeave}
>
  <slot />
</div>

{#if show}
  <div in:fade out:fade class="tooltip" style="top:{y}px; left:{x}px;">
    {title}
  </div>
{/if}

<style>
  .tooltip {
    border: 1px solid lightgray;
    box-shadow: 1px 1px 1px lightgray;
    background: white;
    border-radius: 4px;
    padding: 4px;
    position: absolute;
    pointer-events: none;
    transform: translate(-50%, -100%);
    max-width: 300px;
  }

  .wrapper {
    display: inline;
    cursor: pointer;
  }
</style>
