import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ChatWidgetProvider } from './chat-widget-context';
import { ChatWidget } from './chat-widget';

jest.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

jest.mock('../env', () => ({
  env: { apiUrl: 'http://api.test', clerkPublishableKey: 'pk_test_x' },
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

jest.mock('../usage/use-usage', () => ({
  useUsage: () => ({ usage: null, refetch: jest.fn() }),
}));

function renderWidget(path = '/library') {
  const router = createMemoryRouter(
    [
      {
        path: '/library',
        element: (
          <ChatWidgetProvider>
            <ChatWidget />
          </ChatWidgetProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

test('the launcher renders and the panel starts closed', () => {
  renderWidget();
  expect(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Chat widget')).not.toBeVisible();
});

test('opening the launcher shows the panel with the Ask library tab active by default', async () => {
  renderWidget();
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  );

  expect(screen.getByLabelText('Chat widget')).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Ask library' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByLabelText('question')).toBeVisible();
});

test('clicking the Agent tab switches the active tab; nothing else force-switches it', async () => {
  renderWidget();
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  );
  await userEvent.click(screen.getByRole('tab', { name: 'Agent' }));

  expect(screen.getByRole('tab', { name: 'Agent' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tab', { name: 'Ask library' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
});

test('the close button in the panel header closes the widget', async () => {
  renderWidget();
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Close chat widget' }),
  );

  expect(screen.getByLabelText('Chat widget')).not.toBeVisible();
});

test('a draft typed in the Ask library tab survives closing and reopening the panel', async () => {
  renderWidget();
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  );
  await userEvent.type(screen.getByLabelText('question'), 'What is focus?');

  await userEvent.click(
    screen.getByRole('button', { name: 'Close chat widget' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Toggle chat widget' }),
  );

  expect(screen.getByLabelText('question')).toHaveValue('What is focus?');
});
