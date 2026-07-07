import './globals.css';

export const metadata = {
  title: 'Automação Contábil',
  description: 'Classificação automática de extratos bancários',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
