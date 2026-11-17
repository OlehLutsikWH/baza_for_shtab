// Заміна next/link: перехід усередині демо без перезавантаження сторінки.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { navigate } from '../router';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children?: ReactNode; prefetch?: boolean };

export default function Link({ href, children, onClick, prefetch: _p, ...rest }: Props) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    e.preventDefault();
    navigate(href);
  };
  return <a href="#" data-href={href} {...rest} onClick={go}>{children}</a>;
}
