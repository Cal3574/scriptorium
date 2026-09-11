import { render, cleanup, act } from '@testing-library/react';
import { useArrowNav } from './use-arrow-nav';

function Harness({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  useArrowNav(onPrev, onNext);
  return <input aria-label="field" />;
}

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

test('left / right arrows call onPrev / onNext', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  render(<Harness onPrev={onPrev} onNext={onNext} />);

  press('ArrowLeft');
  press('ArrowRight');

  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});

test('the keys are suppressed while a text field has focus', () => {
  const onPrev = jest.fn();
  const onNext = jest.fn();
  const { getByLabelText } = render(
    <Harness onPrev={onPrev} onNext={onNext} />,
  );
  (getByLabelText('field') as HTMLInputElement).focus();

  press('ArrowLeft');
  press('ArrowRight');

  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});

test('modified arrow presses are ignored', () => {
  const onNext = jest.fn();
  render(<Harness onPrev={jest.fn()} onNext={onNext} />);

  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true }),
    );
  });

  expect(onNext).not.toHaveBeenCalled();
});
