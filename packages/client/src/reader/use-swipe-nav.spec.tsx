import { render, cleanup, act } from '@testing-library/react';
import { useSwipeNav } from './use-swipe-nav';

function Harness({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  const ref = useSwipeNav<HTMLDivElement>(onPrev, onNext);
  return <div ref={ref} data-testid="surface" style={{ height: 200 }} />;
}

afterEach(cleanup);

function touch(clientX: number, clientY = 0) {
  return { clientX, clientY } as Touch;
}

function swipe(el: Element, from: [number, number], to: [number, number]) {
  act(() => {
    el.dispatchEvent(
      new TouchEvent('touchstart', { touches: [touch(...from)] }),
    );
    el.dispatchEvent(
      new TouchEvent('touchend', { changedTouches: [touch(...to)] }),
    );
  });
}

test('a leftward swipe past the threshold calls onNext, rightward calls onPrev', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  const { getByTestId } = render(<Harness onPrev={onPrev} onNext={onNext} />);
  const surface = getByTestId('surface');

  swipe(surface, [200, 100], [100, 100]);
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onPrev).not.toHaveBeenCalled();

  swipe(surface, [100, 100], [200, 100]);
  expect(onPrev).toHaveBeenCalledTimes(1);
});

test('a swipe shorter than the threshold is ignored', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  const { getByTestId } = render(<Harness onPrev={onPrev} onNext={onNext} />);

  swipe(getByTestId('surface'), [100, 100], [80, 100]);

  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});

test('a predominantly vertical drag (scrolling) is ignored', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  const { getByTestId } = render(<Harness onPrev={onPrev} onNext={onNext} />);

  swipe(getByTestId('surface'), [100, 100], [70, 300]);

  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});

test('a multi-touch gesture is ignored', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  const { getByTestId } = render(<Harness onPrev={onPrev} onNext={onNext} />);
  const surface = getByTestId('surface');

  act(() => {
    surface.dispatchEvent(
      new TouchEvent('touchstart', {
        touches: [touch(200, 100), touch(50, 100)],
      }),
    );
    surface.dispatchEvent(
      new TouchEvent('touchend', { changedTouches: [touch(100, 100)] }),
    );
  });

  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});
