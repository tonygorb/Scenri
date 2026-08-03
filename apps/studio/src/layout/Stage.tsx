import { useEffect, useState } from 'react';
import { Box, Flex, Spinner, Text } from '@radix-ui/themes';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { imgUrl, type TextLayer, type TreeNode } from '../api.js';
import { TextOverlayEditor } from '../editor/TextOverlayEditor.js';

/** SQLite datetime('now') is UTC without a zone marker — anchor it before diffing. */
export function elapsedSec(createdAt: string): number {
  const t = Date.parse(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

export function StageFrame({
  node,
  imageIndex,
  layers,
  selectedLayerId,
  onSelectLayer,
  onLayersChange,
  onRetry,
}: {
  node: TreeNode;
  imageIndex: number;
  onRetry?: () => void;
  layers: TextLayer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onLayersChange: (ls: TextLayer[]) => void;
}) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [contentRect, setContentRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  const [, force] = useState(0);

  useEffect(() => {
    if (node.status !== 'running') return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [node.status]);

  // object-fit: contain letterboxes inside the element; the editor must sit on
  // the actual image content box or DOM position and flatten output disagree.
  useEffect(() => {
    if (!imgEl) return;
    const compute = () => {
      const { naturalWidth: nw, naturalHeight: nh, clientWidth: cw, clientHeight: ch } = imgEl;
      if (!nw || !nh || !cw || !ch) return;
      const k = Math.min(cw / nw, ch / nh);
      const w = nw * k,
        h = nh * k;
      setContentRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h });
    };
    compute();
    imgEl.addEventListener('load', compute);
    const ro = new ResizeObserver(compute);
    ro.observe(imgEl);
    return () => {
      imgEl.removeEventListener('load', compute);
      ro.disconnect();
    };
  }, [imgEl]);

  if (node.kind === 'root') {
    return (
      <Box className="bt-frame" p="8">
        <Flex direction="column" align="center" gap="2" py="6">
          <Text className="bt-display" size="7" align="center">
            Blank canvas, full brand.
          </Text>
          <Text color="gray" size="2" align="center">
            Pick a Template below (engineered briefs, your product attached) or describe a visual.
          </Text>
        </Flex>
      </Box>
    );
  }
  return (
    <Flex justify="center">
      <Box className="bt-frame" style={{ display: 'inline-block', maxWidth: '100%' }}>
        {node.status === 'running' && (
          <Flex
            align="center"
            justify="center"
            direction="column"
            gap="3"
            style={{ aspectRatio: '4/3', width: 'min(640px, 78vw)' }}
          >
            <Spinner size="3" />
            <Text size="2" color="gray">
              generating, {elapsedSec(node.createdAt)}s
            </Text>
            <Text size="1" color="gray" style={{ maxWidth: 420, textAlign: 'center' }} truncate>
              {node.prompt}
            </Text>
          </Flex>
        )}
        {node.status === 'error' && (
          <Flex direction="column" gap="3" p="5" style={{ width: 'min(420px, 78vw)' }}>
            <Flex align="center" gap="2">
              <WarningCircle size={16} color="var(--red-9)" weight="fill" />
              <Text size="2" weight="medium">
                This shot did not finish
              </Text>
            </Flex>
            <Text size="1" style={{ color: 'var(--bt-fg2)', lineHeight: 1.5 }}>
              {node.error}
            </Text>
            {node.prompt && (
              <Text
                size="1"
                style={{
                  color: 'var(--bt-fg3)',
                  lineHeight: 1.5,
                  borderTop: '1px solid var(--bt-line)',
                  paddingTop: 10,
                }}
              >
                {node.prompt.replace(/^\[[^\]]*\]\s*/, '').slice(0, 160)}
              </Text>
            )}
            {onRetry && (
              <button type="button" className="bt-btn bt-btn-primary" style={{ alignSelf: 'start' }} onClick={onRetry}>
                <ArrowClockwise size={13} /> Try again
              </button>
            )}
          </Flex>
        )}
        {node.status === 'done' && node.images[imageIndex] && (
          <Box position="relative" style={{ lineHeight: 0 }}>
            <img
              ref={setImgEl}
              src={imgUrl(node.images[imageIndex])}
              alt={node.prompt}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '62vh' }}
            />
            {contentRect && (
              <div
                style={{
                  position: 'absolute',
                  left: contentRect.left,
                  top: contentRect.top,
                  width: contentRect.width,
                  height: contentRect.height,
                  lineHeight: 'normal',
                }}
              >
                <TextOverlayEditor
                  layers={layers}
                  selectedId={selectedLayerId}
                  onSelect={onSelectLayer}
                  onChange={onLayersChange}
                  contentWidth={contentRect.width}
                />
              </div>
            )}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
