/**
 * 창을 화면 맨 위로 올려 붙인다.
 *
 * position:fixed는 보통 화면 전체를 기준으로 잡히지만, 조상 중에 transform이나
 * filter, backdrop-filter가 걸린 요소가 하나라도 있으면 기준이 그 요소로 바뀐다.
 * 헤더에 backdrop-blur가 걸려 있어, 헤더 안에서 연 창은 화면이 아니라 56픽셀짜리
 * 헤더를 기준으로 가운데 정렬됐다. 창의 위쪽 절반이 화면 밖으로 잘려 나갔다
 * — [사용 방법]과 [건의하기]가 실제로 그랬다.
 *
 * z-index를 올려도 안 된다. 같은 이유로 헤더가 만든 쌓임 맥락에 갇힌다.
 * 창을 body 바로 아래로 옮기는 것이 유일하게 확실한 방법이다.
 *
 * 여는 동안 뒤쪽 스크롤도 막는다. 창 안에서 굴렸는데 뒤 페이지가 움직이면
 * 창을 닫았을 때 보던 자리를 잃는다.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ModalPortal({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
