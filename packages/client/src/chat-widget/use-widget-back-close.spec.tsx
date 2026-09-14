import { render, screen, cleanup, act } from '@testing-library/react';
import { useState } from 'react';

import { useWidgetBackClose } from './use-widget-back-close';

function Harness({ onBack }: { onBack: () => void }) {
  const [active, setActive] = useState(false);
  useWidgetBackClose(active, onBack);
  return (
    <div>
      <span data-testid="active">{active ? 'active' : 'inactive'}</span>
      <button onClick={() => setActive(true)}>activate</button>
      <button onClick={() => setActive(false)}>deactivate</button>
    </div>
  );
}

afterEach(cleanup);

test('going active pushes a history entry', () => {
  const lengthBefore = window.history.length;
  render(<Harness onBack={jest.fn()} />);

  act(() => screen.getByText('activate').click());

  expect(window.history.length).toBe(lengthBefore + 1);
});

test('a popstate while active calls onBack, and does not push another entry on cleanup', () => {
  const onBack = jest.fn();
  render(<Harness onBack={onBack} />);
  act(() => screen.getByText('activate').click());
  const lengthAfterPush = window.history.length;

  act(() => window.dispatchEvent(new PopStateEvent('popstate')));

  expect(onBack).toHaveBeenCalledTimes(1);
  // The browser itself consumed the pushed entry via the back navigation -
  // history length is unaffected by our own popstate handler.
  expect(window.history.length).toBe(lengthAfterPush);
});

test('deactivating any other way (not a back press) consumes the pushed entry itself', () => {
  const backSpy = jest.spyOn(window.history, 'back');
  render(<Harness onBack={jest.fn()} />);
  act(() => screen.getByText('activate').click());

  act(() => screen.getByText('deactivate').click());

  expect(backSpy).toHaveBeenCalledTimes(1);
  backSpy.mockRestore();
});

test('unmounting while active also consumes the pushed entry', () => {
  const backSpy = jest.spyOn(window.history, 'back');
  const { unmount } = render(<Harness onBack={jest.fn()} />);
  act(() => screen.getByText('activate').click());

  unmount();

  expect(backSpy).toHaveBeenCalledTimes(1);
  backSpy.mockRestore();
});

test('never active, never touches history', () => {
  const pushSpy = jest.spyOn(window.history, 'pushState');
  const backSpy = jest.spyOn(window.history, 'back');
  render(<Harness onBack={jest.fn()} />);

  expect(pushSpy).not.toHaveBeenCalled();
  expect(backSpy).not.toHaveBeenCalled();
  pushSpy.mockRestore();
  backSpy.mockRestore();
});
