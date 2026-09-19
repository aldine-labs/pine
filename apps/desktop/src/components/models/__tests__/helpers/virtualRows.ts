import { unref } from "vue";

interface VirtualizerLike {
  value: unknown;
}

interface VirtualizerOptions {
  count: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => string | number;
}

function buildItems(options: VirtualizerOptions) {
  let start = 0;
  return Array.from({ length: options.count }, (_, index) => {
    const size = options.estimateSize(index);
    const item = {
      end: start + size,
      index,
      key: options.getItemKey(index),
      lane: 0,
      size,
      start,
    };
    start += size;
    return item;
  });
}

/**
 * happy-dom reports a zero-sized scroll rect, so the real virtualizer would not
 * mount any row. Rendering every row keeps specs about behavior rather than
 * scroll geometry.
 */
export function withAllRows<T extends VirtualizerLike>(
  useVirtualizer: (options: never) => T,
): (options: never) => T {
  return (options) => {
    const instance = useVirtualizer(options);
    Object.assign(instance.value as object, {
      getVirtualItems: () =>
        buildItems(unref(options) as unknown as VirtualizerOptions),
    });
    return instance;
  };
}
