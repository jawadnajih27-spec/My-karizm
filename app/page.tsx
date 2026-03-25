// ============================================
// قاعدة البيانات + API + UI في ملف واحد!
// ============================================

import Database from 'better-sqlite3';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

// ───────────────────────────────────────────
// قاعدة البيانات (SQLite)
// ───────────────────────────────────────────
const db = new Database(':memory:'); // أو './store.db' للحفظ الدائم

// إنشاء الجداول
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT,
    stock INTEGER DEFAULT 10,
    category TEXT
  );
  
  CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    quantity INTEGER DEFAULT 1,
    session_id TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    items TEXT,
    total REAL,
    customer_name TEXT,
    phone TEXT,
    address TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// إضافة منتجات تجريبية
const seedData = db.prepare(`
  INSERT OR IGNORE INTO products (id, name, price, image, category) VALUES 
  (1, 'سماعات لاسلكية', 299, '🎧', 'إلكترونيات'),
  (2, 'ساعة ذكية', 599, '⌚', 'إلكترونيات'),
  (3, 'حقيبة ظهر', 149, '🎒', 'أزياء'),
  (4, 'كوب حراري', 89, '☕', 'منزل'),
  (5, 'كتاب تطوير ذاتي', 79, '📚', 'كتب'),
  (6, 'لوحة مفاتيح ميكانيكية', 449, '⌨️', 'إلكترونيات')
`);

try { seedData.run(); } catch {}

// ───────────────────────────────────────────
// أنواع البيانات
// ───────────────────────────────────────────
type Product = { id: number; name: string; price: number; image: string; stock: number; category: string };
type CartItem = Product & { quantity: number; cart_id: number };
type Order = { id: number; items: string; total: number; customer_name: string; status: string; created_at: string };

// ───────────────────────────────────────────
// دوال الخادم (Server Actions)
// ───────────────────────────────────────────

async function getSessionId() {
  const cookieStore = cookies();
  let sessionId = cookieStore.get('session_id')?.value;
  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15);
    cookieStore.set('session_id', sessionId, { maxAge: 60 * 60 * 24 * 7 });
  }
  return sessionId;
}

async function addToCart(productId: number) {
  'use server';
  const sessionId = await getSessionId();
  const existing = db.prepare('SELECT * FROM cart WHERE product_id = ? AND session_id = ?').get(productId, sessionId);
  
  if (existing) {
    db.prepare('UPDATE cart SET quantity = quantity + 1 WHERE product_id = ? AND session_id = ?').run(productId, sessionId);
  } else {
    db.prepare('INSERT INTO cart (product_id, session_id) VALUES (?, ?)').run(productId, sessionId);
  }
  revalidatePath('/');
}

async function removeFromCart(cartId: number) {
  'use server';
  db.prepare('DELETE FROM cart WHERE id = ?').run(cartId);
  revalidatePath('/');
}

async function updateQuantity(cartId: number, quantity: number) {
  'use server';
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart WHERE id = ?').run(cartId);
  } else {
    db.prepare('UPDATE cart SET quantity = ? WHERE id = ?').run(quantity, cartId);
  }
  revalidatePath('/');
}

async function checkout(formData: FormData) {
  'use server';
  const sessionId = await getSessionId();
  const cartItems = db.prepare(`
    SELECT c.*, p.name, p.price, p.image 
    FROM cart c 
    JOIN products p ON c.product_id = p.id 
    WHERE c.session_id = ?
  `).all(sessionId) as CartItem[];
  
  if (cartItems.length === 0) return;
  
  const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const itemsJson = JSON.stringify(cartItems.map(i => ({ name: i.name, qty: i.quantity, price: i.price })));
  
  db.prepare(`
    INSERT INTO orders (items, total, customer_name, phone, address) 
    VALUES (?, ?, ?, ?, ?)
  `).run(itemsJson, total, formData.get('name'), formData.get('phone'), formData.get('address'));
  
  // تفريغ السلة
  db.prepare('DELETE FROM cart WHERE session_id = ?').run(sessionId);
  revalidatePath('/');
}

// ───────────────────────────────────────────
// المكونات (Components)
// ───────────────────────────────────────────

function ProductCard({ product, inCart }: { product: Product; inCart?: number }) {
  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
      <div className="h-48 bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-6xl">
        {product.image}
      </div>
      <div className="p-5">
        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
          {product.category}
        </span>
        <h3 className="text-lg font-bold mt-2 text-gray-800">{product.name}</h3>
        <div className="flex items-center justify-between mt-4">
          <span className="text-2xl font-bold text-green-600">{product.price} ر.س</span>
          <form action={addToCart.bind(null, product.id)}>
            <button 
              type="submit"
              disabled={inCart !== undefined}
              className={`px-4 py-2 rounded-lg font-bold transition-colors ${
                inCart !== undefined 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
              }`}
            >
              {inCart !== undefined ? `في السلة (${inCart})` : 'أضف للسلة'}
            </button>
          </form>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          {product.stock > 0 ? `متوفر: ${product.stock}` : 'نفذت الكمية'}
        </div>
      </div>
    </div>
  );
}

function CartSidebar({ items }: { items: CartItem[] }) {
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 sticky top-4">
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          🛒 سلة التسوق
        </h2>
        <p className="text-gray-500 text-center py-8">السلة فارغة</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 sticky top-4 max-h-[90vh] overflow-y-auto">
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        🛒 سلة التسوق ({items.reduce((a, b) => a + b.quantity, 0)})
      </h2>
      
      <div className="space-y-3 mb-6">
        {items.map((item) => (
          <div key={item.cart_id} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
            <span className="text-2xl">{item.image}</span>
            <div className="flex-1">
              <h4 className="font-bold text-sm">{item.name}</h4>
              <p className="text-green-600 font-bold">{item.price} ر.س</p>
            </div>
            <div className="flex items-center gap-2">
              <form action={updateQuantity.bind(null, item.cart_id, item.quantity - 1)}>
                <button type="submit" className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 font-bold">-</button>
              </form>
              <span className="w-8 text-center font-bold">{item.quantity}</span>
              <form action={updateQuantity.bind(null, item.cart_id, item.quantity + 1)}>
                <button type="submit" className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 font-bold">+</button>
              </form>
            </div>
            <form action={removeFromCart.bind(null, item.cart_id)}>
              <button type="submit" className="text-red-500 hover:text-red-700 text-xl">🗑️</button>
            </form>
          </div>
        ))}
      </div>
      
      <div className="border-t pt-4 mb-6">
        <div className="flex justify-between text-xl font-bold mb-2">
          <span>الإجمالي:</span>
          <span className="text-green-600">{total.toFixed(2)} ر.س</span>
        </div>
      </div>
      
      <form action={checkout} className="space-y-3">
        <input 
          name="name" 
          placeholder="الاسم الكامل" 
          required 
          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <input 
          name="phone" 
          placeholder="رقم الجوال" 
          required 
          type="tel"
          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <textarea 
          name="address" 
          placeholder="عنوان التوصيل" 
          required 
          rows={3}
          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
        />
        <button 
          type="submit"
          className="w-full bg-green-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-700 active:scale-95 transition-all"
        >
          ✅ إتمام الطلب ({total.toFixed(2)} ر.س)
        </button>
      </form>
    </div>
  );
}

function OrdersList({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return null;
  
  return (
    <div className="mt-12 bg-white rounded-2xl shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">📦 طلباتي السابقة</h2>
      <div className="space-y-4">
        {orders.map((order) => {
          const items = JSON.parse(order.items);
          return (
            <div key={order.id} className="border rounded-xl p-4 bg-gray-50">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <span className="text-sm text-gray-500">طلب #{order.id}</span>
                  <h3 className="font-bold">{order.customer_name}</h3>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                  order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                }`}>
                  {order.status === 'pending' ? '⏳ قيد المعالجة' : '✅ تم التوصيل'}
                </span>
              </div>
              <div className="space-y-1 mb-3">
                {items.map((item: any, idx: number) => (
                  <div key={idx} className="text-sm text-gray-600 flex justify-between">
                    <span>{item.name} × {item.qty}</span>
                    <span>{(item.price * item.qty).toFixed(2)} ر.س</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-3 border-t font-bold text-lg">
                <span>الإجمالي:</span>
                <span className="text-green-600">{order.total.toFixed(2)} ر.س</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────
// الصفحة الرئيسية (Server Component)
// ───────────────────────────────────────────

export default async function Home() {
  const sessionId = await getSessionId();
  
  // جلب البيانات
  const products = db.prepare('SELECT * FROM products').all() as Product[];
  const cartItems = db.prepare(`
    SELECT c.*, p.name, p.price, p.image 
    FROM cart c 
    JOIN products p ON c.product_id = p.id 
    WHERE c.session_id = ?
  `).all(sessionId) as CartItem[];
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all() as Order[];
  
  // تصنيف المنتجات
  const categories = [...new Set(products.map(p => p.category))];
  
  return (
    <div className="max-w-7xl mx-auto p-4">
      {/* الهيدر */}
      <header className="mb-8 text-center py-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl text-white shadow-xl">
        <h1 className="text-4xl font-bold mb-2">🛍️ متجرك الإلكتروني</h1>
        <p className="text-blue-100">تسوق بذكاء، ادفع بسهولة</p>
      </header>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* المنتجات */}
        <div className="lg:col-span-2 space-y-6">
          {categories.map(category => (
            <div key={category}>
              <h2 className="text-2xl font-bold mb-4 text-gray-800 flex items-center gap-2">
                {category}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {products
                  .filter(p => p.category === category)
                  .map(product => {
                    const inCart = cartItems.find(c => c.product_id === product.id);
                    return (
                      <ProductCard 
                        key={product.id} 
                        product={product} 
                        inCart={inCart?.quantity}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
          
          <OrdersList orders={orders} />
        </div>
        
        {/* السلة */}
        <div className="lg:col-span-1">
          <CartSidebar items={cartItems} />
        </div>
      </div>
      
      {/* الفوتر */}
      <footer className="mt-12 text-center text-gray-500 py-8 border-t">
        <p>© 2024 متجرك الإلكتروني - بني بـ 3 ملفات فقط! 🚀</p>
      </footer>
    </div>
  );
}
