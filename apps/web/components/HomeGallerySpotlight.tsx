"use client";

import { useEffect, useState } from "react";
import {
  HomeGalleryLightbox,
  type GallerySpotlightItem,
} from "@/components/HomeGalleryLightbox";

const spotlightLimit = 4;

function itemIdentity(item: GallerySpotlightItem) {
  return item.full || item.image || item.key;
}

function uniqueItems(items: GallerySpotlightItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const identity = itemIdentity(item);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function randomValue() {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
  }

  return Math.random();
}

function shuffleItems(items: GallerySpotlightItem[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomValue() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function deterministicItems(
  candidates: GallerySpotlightItem[],
  fallbackItems: GallerySpotlightItem[],
) {
  return uniqueItems([...candidates, ...fallbackItems]).slice(0, spotlightLimit);
}

function randomSpotlightItems(
  candidates: GallerySpotlightItem[],
  fallbackItems: GallerySpotlightItem[],
) {
  const selected = shuffleItems(uniqueItems(candidates)).slice(0, spotlightLimit);
  if (selected.length >= spotlightLimit) return selected;

  const selectedIds = new Set(selected.map(itemIdentity));
  const fallback = shuffleItems(uniqueItems(fallbackItems))
    .filter((item) => !selectedIds.has(itemIdentity(item)))
    .slice(0, spotlightLimit - selected.length);

  return [...selected, ...fallback];
}

export function HomeGallerySpotlight({
  candidates,
  fallbackItems,
}: {
  candidates: GallerySpotlightItem[];
  fallbackItems: GallerySpotlightItem[];
}) {
  const [items, setItems] = useState(() => deterministicItems(candidates, fallbackItems));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems(randomSpotlightItems(candidates, fallbackItems));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [candidates, fallbackItems]);

  return <HomeGalleryLightbox items={items} />;
}
