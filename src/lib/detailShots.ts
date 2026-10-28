/**
 * 상세페이지 자동 제작용 사진 생성 (의류).
 *
 * 올린 사진 1~3장만으로는 상세페이지가 빈약하다. 상세페이지 제작 기능과 같은
 * 이미지 모델로 모델컷을 만들어 템플릿에 흘려 넣는다. 비용을 묶기 위해 4장만:
 *   0 히어로(전신, high) → 1·2·3 (medium, 히어로를 참조해 같은 모델·장소로)
 * 히어로를 먼저 받고 나머지 3장을 동시에 보낸다. 한 장이 실패해도 나머지는 쓴다.
 */
import { generateImage } from '../api/aiService';
import type { DetailPlanLite } from './coupang';

const DEFAULT_SHOTS = [
  'Full-body shot of the model wearing the garment, standing naturally in a bright minimal studio or a quiet city street, soft daylight, medium distance.',
  'Three-quarter body shot, the model turned slightly, one hand in pocket or adjusting a sleeve, relaxed expression, same location.',
  'Close-up of the fabric and stitching on the garment while worn — collar, sleeve hem or seam — macro feel, crisp texture.',
  'Back view full-body shot of the model walking away slowly, showing the garment silhouette from behind, same location.',
];

/** 공개 URL → data URL (서버는 data URL만 받는다) */
export const toDataUrl = async (src: string): Promise<string> => {
  if (src.startsWith('data:')) return src;
  const blob = await (await fetch(src)).blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    r.readAsDataURL(blob);
  });
};

const prompt = (productName: string, scene: string, refCount: number, hasHero: boolean) => [
  `Premium Korean fashion e-commerce detail page photo for "${productName}", vertical.`,
  'Look: clean lookbook editorial. Real photo-shoot quality — soft directional daylight, natural fill, true-to-life color, real fabric texture, shallow depth of field. Not a collage, not a catalog cutout.',
  '',
  `SCENE: ${scene}`,
  '',
  `PRODUCT FIDELITY (most important): the first ${refCount} uploaded image${refCount > 1 ? 's are' : ' is'} the exact garment. Keep its shape, color, print, logo, material, proportions and every visible detail identical. Never redesign, recolor, simplify or swap it. Use a new fictional Korean model in their 20s–30s.`,
  hasHero ? 'CONSISTENCY: the last input image is the approved hero of this same page. Use the same model (same face, hair, body), the same location family, the same light and color grade, but a different pose, angle and crop.' : '',
  'COMPOSITION: one focal subject, calm negative space, no split panels, no white header/footer bands.',
  'NO TEXT: do not render any letters, numbers, logos, badges, labels or watermarks. Only lettering that already exists on the garment may remain.',
  'AVOID: plastic skin, warped hands, floating objects, HDR glow, heavy vignette.',
].filter(Boolean).join('\n');

export interface ShotResult { shots: string[]; failed: number }

export async function generateClothingShots(
  plan: DetailPlanLite, productName: string, photoUrls: string[], onProgress: (msg: string) => void,
): Promise<ShotResult> {
  const scenes = [...(plan.shots ?? [])];
  while (scenes.length < 4) scenes.push(DEFAULT_SHOTS[scenes.length]);
  onProgress('사진을 준비하는 중…');
  const refs = (await Promise.all(photoUrls.slice(0, 3).map(u => toDataUrl(u).catch(() => '')))).filter(Boolean);
  const roles = refs.map((_, i) => `Image ${i + 1}: the exact garment to preserve`);

  onProgress('대표 모델컷을 만드는 중… (1/4)');
  const hero = (await generateImage(prompt(productName, scenes[0], refs.length, false), refs, '9:16', 'high', {
    inputFidelity: 'high', variantCount: 1, referenceRoles: roles, pacingMode: 'auto', priority: 1,
  }))?.image;
  if (!hero) throw new Error('대표 모델컷을 만들지 못했습니다. 이미지 생성 한도나 네트워크를 확인해 주세요.');

  let done = 1;
  const rest = await Promise.all(scenes.slice(1, 4).map(async (scene, i) => {
    try {
      const r = await generateImage(prompt(productName, scene, refs.length, true), [...refs, hero], '9:16', 'medium', {
        inputFidelity: 'high', variantCount: 1, referenceRoles: [...roles, `Image ${refs.length + 1}: APPROVED HERO — match this model, location, light and color grade`], pacingMode: 'auto', priority: i + 2,
      });
      return r?.image || '';
    } catch { return ''; } finally { done++; onProgress(`모델컷을 만드는 중… (${done}/4)`); }
  }));
  return { shots: [hero, ...rest], failed: rest.filter(s => !s).length };
}
