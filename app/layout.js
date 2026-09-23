import "./pairer.css";

export const metadata = {
  title: "What goes with this?",
  description: "Snap one clothing item. Get three pieces that pair with it, ready to buy.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3f2f2",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
