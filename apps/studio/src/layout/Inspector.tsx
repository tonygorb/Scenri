import { Flex, ScrollArea, Text } from '@radix-ui/themes';
import type { Brand, TreeNode } from '../api.js';
import { Confirm } from '../Confirm.js';
import { briefProse, type ProseNames } from '../briefDiff.js';

/**
 * What this shot is: its brief, its ingredients, and the things you can do to
 * the file itself. Lives inside the detail overlay.
 *
 * There used to be a Text tab beside this one, for laying editable captions
 * over a shot. That is composition, not photography — Scenri makes the
 * picture — and it had grown into the loudest control on the screen while the
 * shot itself floated small beside it.
 */
export function Inspector(props: {
  node: TreeNode | null;
  nodes: TreeNode[];
  imageIndex: number;
  onChanged: () => void;
  brand: Brand;
  /** Display-name resolvers, so the brief reads with its nouns in place. */
  names: ProseNames;
  onExport: () => void;
  /** Omitted rather than disabled: there's nothing to diff against without a parent shot. */
  onCompare?: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const { node } = props;
  return (
    // No flex:1. This renders one label and one paragraph; claiming the rest of
    // the column left 455px of empty rail directly under the shot you just made.
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {!node ? (
        <Flex align="center" justify="center" style={{ flex: 1 }} p="4">
          <Text size="1" style={{ color: 'var(--sc-fg3)', textAlign: 'center' }}>
            Pick a shot to see its details.
          </Text>
        </Flex>
      ) : (
        <ScrollArea>
          <div style={{ padding: '14px 2px 14px 0' }}>
            <InfoTab {...props} node={node} />
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-eyebrow" style={{ margin: '16px 0 7px' }}>
      {children}
    </div>
  );
}

function InfoTab({
  node,
  names,
  onCompare,
  onDelete,
}: {
  node: TreeNode;
  names: ProseNames;
  onCompare?: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="sc-eyebrow">Brief</div>
      {/* What was asked for, not what the compiler made of it. */}
      <p className="sc-brief-record">{briefProse(node, names) || '(none)'}</p>
      {/* Export, keeper and archive are all one press away in the tools over
          the shot, and the header already says the engine and the cost. What
          was here repeated every one of them as a full-width button, so the
          panel read as a settings page for a photograph. Compare stays: it is
          the only thing here with nowhere else to live.

          The failure used to be stated here too, as a bare Radix callout
          printing the engine's raw JSON — a second copy of what the stage a few
          hundred pixels to the left was already saying, in a different visual
          language, with no action attached. The stage owns it now, and on a
          phone the stage stacks first, so it is still the first thing read. */}
      {/* Compare is the one thing here with nowhere else to live. */}
      {onCompare && (
        <>
          <SectionLabel>Compare</SectionLabel>
          <button type="button" className="sc-btn sc-btn-ghost" style={{ width: '100%' }} onClick={onCompare}>
            Show what changed
          </button>
        </>
      )}

      {node.archived && (
        <div style={{ marginTop: 16 }}>
          <Confirm
            label="Delete this shot permanently"
            title="Delete this shot permanently?"
            body="This cannot be undone."
            busy={false}
            onConfirm={onDelete}
            fullWidth
          />
        </div>
      )}
    </>
  );
}
