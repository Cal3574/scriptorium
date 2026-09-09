import { render, screen, cleanup } from '@testing-library/react';

import { BookCover } from './book-cover';

afterEach(cleanup);

describe('BookCover', () => {
  it('stamps the title initials on the generated tile', () => {
    render(<BookCover id="b1" title="Deep Work" />);
    expect(screen.getByText('DW')).toBeInTheDocument();
  });

  it('renders the real thumbnail instead of a tile when src is given', () => {
    render(
      <BookCover id="b1" title="Deep Work" src="data:image/png;base64,AAA" />,
    );
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAA');
    expect(screen.queryByText('DW')).not.toBeInTheDocument();
  });

  it('is hidden from assistive tech either way', () => {
    const { container, rerender } = render(
      <BookCover id="b1" title="Deep Work" />,
    );
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    rerender(<BookCover id="b1" title="Deep Work" src="x.png" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
