import {
  ElIcon
} from 'element-plus';
import {
  defineComponent,
  h,
  type CSSProperties,
} from 'vue';

export const NIcon = defineComponent({
  name: 'NIcon',
  props: {
    component: { type: Object, required: false, default: undefined },
  },
  setup(props, { attrs, slots }) {
    return () => {
      const Comp = props.component as never;
      return h(
        ElIcon,
        attrs,
        () => (Comp ? h(Comp) : slots.default?.()),
      );
    };
  },
});

export const NText = defineComponent({
  name: 'NText',
  props: {
    depth: { type: [String, Number], default: undefined },
    type: { type: String, default: undefined },
    strong: Boolean,
    tag: { type: String, default: 'span' },
    ellipsis: { type: [Boolean, Object], default: false },
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        props.tag,
        {
          ...attrs,
          class: [
            attrs.class,
            props.strong ? 'n-text-strong' : null,
            props.type ? `n-text-${props.type}` : null,
            props.depth ? `n-text-depth-${props.depth}` : null,
          ],
          style: [
            attrs.style as CSSProperties | undefined,
            props.ellipsis
              ? {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }
              : null,
          ],
        },
        slots.default?.(),
      );
  },
});

export const NSpace = defineComponent({
  name: 'NSpace',
  props: {
    size: { type: [String, Number], default: 8 },
    align: { type: String, default: undefined },
    justify: { type: String, default: undefined },
    vertical: Boolean,
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        'div',
        {
          ...attrs,
          style: [
            {
              display: 'flex',
              flexDirection: props.vertical ? 'column' : 'row',
              alignItems: props.align,
              justifyContent: props.justify,
              gap: typeof props.size === 'number' ? `${props.size}px` : props.size,
              flexWrap: 'wrap',
            },
            attrs.style as CSSProperties | undefined,
          ],
        },
        slots.default?.(),
      );
  },
});

export const NSpin = defineComponent({
  name: 'NSpin',
  props: {
    description: { type: String, default: undefined },
    size: { type: String, default: 'medium' },
  },
  setup(props, { slots, attrs }) {
    return () =>
      h('div', { ...attrs, class: ['n-spin-wrap', attrs.class] }, [
        h('div', {
          class: [
            'n-spin-indicator',
            `n-spin-indicator--${props.size}`,
          ],
        }),
        props.description
          ? h('div', { class: 'n-spin-description' }, props.description)
          : slots.description
            ? h('div', { class: 'n-spin-description' }, slots.description())
            : null,
        slots.default?.(),
      ]);
  },
});

export const NEllipsis = defineComponent({
  name: 'NEllipsis',
  setup(_, { slots, attrs }) {
    return () =>
      h(
        'span',
        {
          ...attrs,
          style: [
            attrs.style as CSSProperties | undefined,
            {
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'inline-block',
              maxWidth: '100%',
            },
          ],
        },
        slots.default?.(),
      );
  },
});
