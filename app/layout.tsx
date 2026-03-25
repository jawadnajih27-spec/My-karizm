export const metadata = { title: 'متجر إلكتروني', description: 'تسوق بذكاء' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
