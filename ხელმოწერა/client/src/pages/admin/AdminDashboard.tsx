import { useState, useEffect } from "react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Edit, Tag, Trash2, Search, LogOut, Package, Users, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { type Product } from "@shared/schema";

export default function AdminDashboard() {
  const { logout } = useAdminAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingProduct, setIsAddingProduct] = useState(false);

  const [dealer, setDealer] = useState<string>(
    (localStorage.getItem("admin_dealer") as any) || "iron",
  );

  // Admin tab: "products" or "dealers"
  const [adminTab, setAdminTab] = useState<"products" | "dealers">("products");

  // Dealer Management State
  interface DealerRecord {
    id: number;
    key: string;
    name: string;
    identificationCode?: string | null;
    email: string | null;
    createdAt: string | null;
  }
  const [dealersList, setDealersList] = useState<DealerRecord[]>([]);
  const [isDealersLoading, setIsDealersLoading] = useState(false);
  const [isAddDealerOpen, setIsAddDealerOpen] = useState(false);
  const [isAddingDealer, setIsAddingDealer] = useState(false);
  const [newDealer, setNewDealer] = useState({ name: "", identificationCode: "", email: "", password: "" });
  const [showNewDealerPassword, setShowNewDealerPassword] = useState(false);

  const [editingDealer, setEditingDealer] = useState<DealerRecord | null>(null);
  const [editDealerForm, setEditDealerForm] = useState({ name: "", identificationCode: "", email: "", password: "" });
  const [showEditPassword, setShowEditPassword] = useState(false);

  // New Product Form State
  const [newProduct, setNewProduct] = useState({
    name: "",
    description: "",
    price: "",
    category: "",
    imageUrl: "",
    stock: "0",
  });

  // Edit Price State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newPrice, setNewPrice] = useState("");

  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    category: "",
    imageUrl: "",
    stock: "0",
    price: "",
    discountType: "percentage" as "percentage" | "fixed" | "none",
    discountPercent: "",
    discountValue: "",
    discountExpiry: "",
  });

  // Discount State
  const [discountingProduct, setDiscountingProduct] = useState<Product | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountExpiry, setDiscountExpiry] = useState("");

  // Gorgia branch management
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [isBranchLoading, setIsBranchLoading] = useState(true);
  const [newBranchName, setNewBranchName] = useState("");
  const [editingBranch, setEditingBranch] = useState<{ id: number; name: string } | null>(null);
  const [branchNameDraft, setBranchNameDraft] = useState("");

  const maxDiscountCents = 300 * 100;

  const calcCappedDiscountAmountCents = (priceCents: number, pct: number) => {
    const pctSafe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    return Math.min(Math.round(priceCents * (pctSafe / 100)), maxDiscountCents);
  };

  const fetchDealers = async () => {
    setIsDealersLoading(true);
    try {
      const res = await fetch("/api/admin/dealers", {
        headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDealersList(data);
    } catch (err) {
      toast({ title: "შეცდომა", description: "დილერების ჩატვირთვა ვერ მოხერხდა", variant: "destructive" });
    } finally {
      setIsDealersLoading(false);
    }
  };

  const handleAddDealer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingDealer(true);
    try {
      const res = await fetch("/api/admin/dealers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify(newDealer),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to add");
      }
      toast({ title: "წარმატებით", description: "დილერი წარმატებით დაემატა" });
      setNewDealer({ name: "", identificationCode: "", email: "", password: "" });
      setIsAddDealerOpen(false);
      fetchDealers();
    } catch (err) {
      toast({ title: "შეცდომა", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsAddingDealer(false);
    }
  };

  const handleUpdateDealer = async () => {
    if (!editingDealer) return;
    try {
      const body: any = {};
      if (editDealerForm.name) body.name = editDealerForm.name;
      if (editDealerForm.identificationCode) body.identificationCode = editDealerForm.identificationCode;
      if (editDealerForm.email) body.email = editDealerForm.email;
      if (editDealerForm.password) body.password = editDealerForm.password;

      const res = await fetch(`/api/admin/dealers/${editingDealer.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update");
      }
      toast({ title: "წარმატებით", description: "დილერი განახლდა" });
      setEditingDealer(null);
      fetchDealers();
    } catch (err) {
      toast({ title: "შეცდომა", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDeleteDealer = async (id: number) => {
    if (!confirm("დარწმუნებული ხართ? წაიშლება დილერის ყველა პროდუქტი და ფილიალი!")) return;
    try {
      const res = await fetch(`/api/admin/dealers/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast({ title: "წაიშალა", description: "დილერი და მისი მონაცემები წაიშალა" });
      fetchDealers();
    } catch (err) {
      toast({ title: "შეცდომა", description: "დილერის წაშლა ვერ მოხერხდა", variant: "destructive" });
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`/api/admin/products?dealer=${dealer}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("admin_token");
          window.location.href = "/login";
          return;
        }
        throw new Error("Failed to fetch");
      }
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      toast({ title: "შეცდომა", description: "პროდუქტების ჩატვირთვა ვერ მოხერხდა", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBranches = async () => {
    if (dealer !== "gorgia") {
      setBranches([]);
      setIsBranchLoading(false);
      return;
    }

    setIsBranchLoading(true);
    try {
      const res = await fetch(`/api/admin/branches?dealer=${dealer}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setBranches(data);
    } catch (err) {
      toast({ title: "შეცდომა", description: "ფილიალების ჩატვირთვა ვერ მოხერხდა", variant: "destructive" });
    } finally {
      setIsBranchLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchBranches();
  }, [dealer]);

  useEffect(() => {
    fetchDealers();
  }, []);

  useEffect(() => {
    if (adminTab === "dealers") {
      fetchDealers();
    }
  }, [adminTab]);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingProduct(true);
    try {
      const res = await fetch(`/api/admin/products?dealer=${dealer}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({
          ...newProduct,
          price: Math.round(parseFloat(newProduct.price) * 100), // convert to cents
          stock: parseInt(newProduct.stock),
        }),
      });
      if (!res.ok) throw new Error("Failed to add");
      toast({ title: "წარმატებით", description: "პროდუქტი წარმატებით დაემატა" });
      setNewProduct({ name: "", description: "", price: "", category: "", imageUrl: "", stock: "0" });
      fetchProducts();
    } catch (err) {
      toast({ title: "შეცდომა", description: "პროდუქტის დამატება ვერ მოხერხდა", variant: "destructive" });
    } finally {
      setIsAddingProduct(false);
    }
  };

  const handleAddBranch = async () => {
    if (!newBranchName.trim()) return;
    try {
      const res = await fetch(`/api/admin/branches?dealer=${dealer}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ name: newBranchName.trim() }),
      });

      const responseBody = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message || "Failed to add");

      toast({ title: "წარმატებით", description: "ფილიალი წარმატებით დაემატა" });
      setNewBranchName("");
      fetchBranches();
    } catch (err) {
      toast({
        title: "შეცდომა",
        description: (err as Error)?.message || "ფილიალის დამატება ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  };

  const handleUpdateBranch = async () => {
    if (!editingBranch) return;
    const name = branchNameDraft.trim();
    if (!name) return;
    try {
      const res = await fetch(`/api/admin/branches/${editingBranch.id}?dealer=${dealer}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({ name }),
      });

      const responseBody = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message || "Failed to update");

      toast({ title: "წარმატებით", description: "ფილიალი განახლდა" });
      setEditingBranch(null);
      setBranchNameDraft("");
      fetchBranches();
    } catch (err) {
      toast({
        title: "შეცდომა",
        description: (err as Error)?.message || "ფილიალის განახლება ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  };

  const handleDeleteBranch = async (id: number) => {
    if (!confirm("დარწმუნებული ხართ, რომ გინდათ ფილიალის წაშლა?")) return;
    try {
      const res = await fetch(`/api/admin/branches/${id}?dealer=${dealer}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
      });

      const responseBody = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message || "Failed to delete");

      toast({ title: "წაიშალა", description: "ფილიალი წაიშალა" });
      fetchBranches();
    } catch (err) {
      toast({
        title: "შეცდომა",
        description: (err as Error)?.message || "ფილიალის წაშლა ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  };

  const handleUpdatePrice = async () => {
    if (!editingProduct) return;
    try {
      const priceCents = Math.round(parseFloat(editForm.price || "0") * 100);
      const stock = parseInt(editForm.stock || "0");

      let discountPrice: number | null | undefined = undefined;
      let discountPercentage: number | null | undefined = undefined;
      let discountExpiry: string | null | undefined = undefined;

      if (editForm.discountType === "none") {
        discountPrice = null;
        discountPercentage = null;
        discountExpiry = null;
      } else if (editForm.discountType === "percentage") {
        const pct = parseInt(editForm.discountPercent || "0");
        const pctSafe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
        const discountAmount = Math.min(Math.round(priceCents * (pctSafe / 100)), maxDiscountCents);
        discountPercentage = pctSafe;
        discountPrice = Math.max(0, priceCents - discountAmount);
        discountExpiry = editForm.discountExpiry || null;
      } else if (editForm.discountType === "fixed") {
        const fixedGEL = parseFloat(editForm.discountValue || "0");
        const fixed = Math.min(Math.round(fixedGEL * 100), maxDiscountCents);
        discountPrice = Math.max(0, priceCents - fixed);
        discountPercentage = null;
        discountExpiry = editForm.discountExpiry || null;
      }

      const res = await fetch(`/api/admin/products/${editingProduct.id}?dealer=${dealer}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          category: editForm.category,
          imageUrl: editForm.imageUrl || null,
          stock,
          price: priceCents,
          discountPrice,
          discountPercentage,
          discountExpiry,
        }),
      });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d) => d?.message)
          .catch(() => undefined);
        throw new Error(msg || "Failed to update");
      }
      const updated = (await res.json().catch(() => null)) as Product | null;
      if (updated) {
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      toast({ title: "წარმატებით", description: "პროდუქტი განახლდა" });
      setEditingProduct(null);
      await fetchProducts();
    } catch (err) {
      toast({
        title: "შეცდომა",
        description: err instanceof Error ? err.message : "განახლება ვერ მოხერხდა",
        variant: "destructive",
      });
    }
  };

  const handleSetDiscount = async () => {
    if (!discountingProduct) return;
    try {
      let discountPrice = discountingProduct.price;
      let percentage = 0;

      if (discountType === "percentage") {
        const pct = parseInt(discountValue);
        const pctSafe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
        const discountAmount = Math.min(Math.round(discountingProduct.price * (pctSafe / 100)), maxDiscountCents);
        percentage = pctSafe;
        discountPrice = Math.max(0, discountingProduct.price - discountAmount);
      } else {
        const fixed = Math.min(Math.round(parseFloat(discountValue) * 100), maxDiscountCents);
        discountPrice = Math.max(0, discountingProduct.price - fixed);
        percentage = Math.round(((discountingProduct.price - discountPrice) / discountingProduct.price) * 100);
      }

      const res = await fetch(`/api/admin/products/${discountingProduct.id}/discount?dealer=${dealer}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
        },
        body: JSON.stringify({
          discountPrice,
          discountPercentage: percentage,
          discountExpiry: discountExpiry || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to set discount");
      toast({ title: "წარმატებით", description: "ფასდაკლება დაემატა" });
      setDiscountingProduct(null);
      fetchProducts();
    } catch (err) {
      toast({ title: "შეცდომა", description: "ფასდაკლების დაყენება ვერ მოხერხდა", variant: "destructive" });
    }
  };

  const handleDeleteProduct = async (id: number) => {
    if (!confirm("დარწმუნებული ხართ?")) return;
    try {
      const res = await fetch(`/api/admin/products/${id}?dealer=${dealer}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
      });
      if (!res.ok) throw new Error("წაშლა ვერ მოხერხდა");
      toast({ title: "წაიშალა", description: "პროდუქტი წაიშალა" });
      fetchProducts();
    } catch (err) {
      toast({ title: "შეცდომა", description: "წაშლა ვერ მოხერხდა", variant: "destructive" });
    }
  };

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-muted/20 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary rounded-2xl shadow-lg shadow-primary/20">
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">სუპერ ადმინ პანელი</h1>
              <p className="text-muted-foreground">დილერების და პროდუქტების მართვა</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {adminTab === "products" && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Dealer</Label>
                <select
                  value={dealer}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDealer(next);
                    localStorage.setItem("admin_dealer", next);
                    setIsLoading(true);
                  }}
                  className="h-11 rounded-xl border-2 bg-background px-3 text-sm"
                >
                  {dealersList.length > 0
                    ? dealersList.map((d) => (
                        <option key={d.key} value={d.key}>{d.name}</option>
                      ))
                    : <>
                        <option value="iron">Iron+</option>
                        <option value="gorgia">Gorgia</option>
                      </>
                  }
                </select>
              </div>
            )}
            <Button variant="outline" onClick={logout} className="h-11 rounded-xl border-2">
              <LogOut className="w-4 h-4 mr-2" /> გასვლა
            </Button>
          </div>
        </header>

        {/* Tab Switcher */}
        <div className="flex gap-2 p-1 bg-muted rounded-2xl w-fit">
          <Button
            variant={adminTab === "products" ? "default" : "ghost"}
            onClick={() => setAdminTab("products")}
            className="rounded-xl gap-2"
          >
            <Package className="w-4 h-4" /> პროდუქტები
          </Button>
          <Button
            variant={adminTab === "dealers" ? "default" : "ghost"}
            onClick={() => setAdminTab("dealers")}
            className="rounded-xl gap-2"
          >
            <Users className="w-4 h-4" /> დილერები
          </Button>
        </div>

        {/* ══════ DEALERS TAB ══════ */}
        {adminTab === "dealers" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">დილერების მართვა</h2>
                <p className="text-sm text-muted-foreground">შექმენით, რედაქტირეთ ან წაშალეთ დილერის ანგარიში</p>
              </div>
              <Dialog open={isAddDealerOpen} onOpenChange={setIsAddDealerOpen}>
                <DialogTrigger asChild>
                  <Button className="rounded-xl gap-2 shadow-lg shadow-primary/10">
                    <Plus className="w-4 h-4" /> ახალი დილერი
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-3xl">
                  <DialogHeader>
                    <DialogTitle>ახალი დილერის დამატება</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddDealer} className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>დილერის სახელი</Label>
                      <Input
                        value={newDealer.name}
                        onChange={(e) => setNewDealer({ ...newDealer, name: e.target.value })}
                        placeholder="მაგ: TechStore"
                        required
                        className="h-11 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>საიდენტიფიკაციო კოდი (ს/კ)</Label>
                      <Input
                        value={newDealer.identificationCode}
                        onChange={(e) => setNewDealer({ ...newDealer, identificationCode: e.target.value })}
                        placeholder="9 ან 11 ციფრი"
                        required
                        inputMode="numeric"
                        className="h-11 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ელ-ფოსტა</Label>
                      <Input
                        type="email"
                        value={newDealer.email}
                        onChange={(e) => setNewDealer({ ...newDealer, email: e.target.value })}
                        placeholder="მაგ: info@techstore.ge"
                        required
                        className="h-11 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>პაროლი</Label>
                      <div className="relative">
                        <Input
                          type={showNewDealerPassword ? "text" : "password"}
                          value={newDealer.password}
                          onChange={(e) => setNewDealer({ ...newDealer, password: e.target.value })}
                          placeholder="მინიმუმ 6 სიმბოლო"
                          required
                          minLength={6}
                          className="h-11 rounded-xl pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewDealerPassword(!showNewDealerPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showNewDealerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit" className="w-full h-12 rounded-xl font-bold" disabled={isAddingDealer}>
                        {isAddingDealer ? <Loader2 className="animate-spin" /> : "დამატება"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="border-2 rounded-3xl overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow>
                      <TableHead className="pl-6">ID</TableHead>
                      <TableHead>სახელი</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>ს/კ</TableHead>
                      <TableHead>ელ-ფოსტა</TableHead>
                      <TableHead>შეიქმნა</TableHead>
                      <TableHead className="pr-6 text-right">ქმედებები</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dealersList.map((d) => (
                      <TableRow key={d.id} className="hover:bg-muted/5">
                        <TableCell className="pl-6 font-mono text-xs">{d.id}</TableCell>
                        <TableCell className="font-semibold">{d.name}</TableCell>
                        <TableCell>
                          <span className="px-2 py-1 bg-muted rounded-lg text-xs font-mono">{d.key}</span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.identificationCode || "—"}</TableCell>
                        <TableCell className="text-sm">{d.email || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.createdAt ? new Date(d.createdAt).toLocaleDateString("ka-GE") : "—"}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingDealer(d);
                                setEditDealerForm({ name: d.name, identificationCode: String(d.identificationCode || ""), email: d.email || "", password: "" });
                                setShowEditPassword(false);
                              }}
                              className="h-8 w-8 rounded-lg"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteDealer(d.id)}
                              className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {isDealersLoading && (
                  <div className="p-8 flex items-center justify-center">
                    <Loader2 className="animate-spin text-primary" />
                  </div>
                )}
                {!isDealersLoading && dealersList.length === 0 && (
                  <div className="p-12 text-center text-muted-foreground">დილერები ვერ მოიძებნა</div>
                )}
              </CardContent>
            </Card>

            {/* Edit Dealer Dialog */}
            <Dialog open={!!editingDealer} onOpenChange={(open) => !open && setEditingDealer(null)}>
              <DialogContent className="rounded-3xl">
                <DialogHeader>
                  <DialogTitle>დილერის რედაქტირება: {editingDealer?.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>სახელი</Label>
                    <Input
                      value={editDealerForm.name}
                      onChange={(e) => setEditDealerForm({ ...editDealerForm, name: e.target.value })}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>კომპანიის რეკვიზიტები (დასახ, ს/კ)</Label>
                    <Input
                      value={editDealerForm.identificationCode}
                      onChange={(e) => setEditDealerForm({ ...editDealerForm, identificationCode: e.target.value })}
                      placeholder="9 ან 11 ციფრი"
                      inputMode="numeric"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ელ-ფოსტა</Label>
                    <Input
                      type="email"
                      value={editDealerForm.email}
                      onChange={(e) => setEditDealerForm({ ...editDealerForm, email: e.target.value })}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ახალი პაროლი (ცარიელი = არ შეიცვალოს)</Label>
                    <div className="relative">
                      <Input
                        type={showEditPassword ? "text" : "password"}
                        value={editDealerForm.password}
                        onChange={(e) => setEditDealerForm({ ...editDealerForm, password: e.target.value })}
                        placeholder="ცარიელი = უცვლელი"
                        className="h-11 rounded-xl pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword(!showEditPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleUpdateDealer} className="w-full h-12 rounded-xl font-bold">შენახვა</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ══════ PRODUCTS TAB ══════ */}
        {adminTab === "products" && <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Product Form */}
          <Card className="lg:col-span-1 border-2 shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="bg-muted/30">
              <CardTitle className="text-xl flex items-center gap-2">
                <Plus className="w-5 h-5" /> ახალი პროდუქტის დამატება
              </CardTitle>
              <CardDescription>შეიყვანეთ პროდუქტის მონაცემები მარაგში დასამატებლად</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleAddProduct} className="space-y-4">
                <div className="space-y-2">
                  <Label>პროდუქტის სახელი</Label>
                  <Input 
                    value={newProduct.name}
                    onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                    required
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>აღწერა</Label>
                  <Textarea 
                    value={newProduct.description}
                    onChange={e => setNewProduct({...newProduct, description: e.target.value})}
                    required
                    className="min-h-[100px] rounded-xl"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>ფასი (₾)</Label>
                    <Input 
                      type="number"
                      step="0.01"
                      value={newProduct.price}
                      onChange={e => setNewProduct({...newProduct, price: e.target.value})}
                      required
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>მარაგი</Label>
                    <Input 
                      type="number"
                      value={newProduct.stock}
                      onChange={e => setNewProduct({...newProduct, stock: e.target.value})}
                      required
                      className="h-11 rounded-xl"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>კატეგორია</Label>
                  <Input 
                    value={newProduct.category}
                    onChange={e => setNewProduct({...newProduct, category: e.target.value})}
                    required
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>სურათის URL</Label>
                  <Input 
                    value={newProduct.imageUrl}
                    onChange={e => setNewProduct({...newProduct, imageUrl: e.target.value})}
                    className="h-11 rounded-xl"
                  />
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl font-bold shadow-lg shadow-primary/10" disabled={isAddingProduct}>
                  {isAddingProduct ? <Loader2 className="animate-spin" /> : "პროდუქტის დამატება"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Product List */}
          <Card className="lg:col-span-2 border-2 shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="bg-muted/30 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl">პროდუქტების სია</CardTitle>
                <CardDescription>ფასების და ფასდაკლებების მართვა</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="ძიება..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 rounded-xl bg-background"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/10">
                  <TableRow>
                    <TableHead className="pl-6">პროდუქტი</TableHead>
                    <TableHead>ფასი</TableHead>
                    <TableHead>მარაგი</TableHead>
                    <TableHead className="pr-6 text-right">ქმედებები</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence>
                    {filteredProducts.map((product) => (
                      <TableRow key={product.id} className="group hover:bg-muted/5 transition-colors">
                        <TableCell className="pl-6">
                          <div className="font-semibold">{product.name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">{product.description}</div>
                          {product.discountPercentage && (
                            <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold uppercase">
                              SALE {product.discountPercentage}%
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-bold flex items-center gap-1">
                            {product.discountPrice ? (
                              <>
                                <span className="line-through text-muted-foreground text-xs">{(product.price / 100).toFixed(2)}</span>
                                <span className="text-red-600">{(product.discountPrice / 100).toFixed(2)}</span>
                              </>
                            ) : (
                              (product.price / 100).toFixed(2)
                            )}
                            <span className="text-[10px] text-muted-foreground">GEL</span>
                          </div>
                        </TableCell>
                        <TableCell>{product.stock}</TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Dialog open={editingProduct?.id === product.id} onOpenChange={(open) => !open && setEditingProduct(null)}>
                              <DialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingProduct(product);
                                    setNewPrice((product.price / 100).toString());
                                    setEditForm({
                                      name: product.name || "",
                                      description: product.description || "",
                                      category: product.category || "",
                                      imageUrl: product.imageUrl || "",
                                      stock: String(product.stock ?? 0),
                                      price: String((product.price ?? 0) / 100),
                                      discountType: product.discountPrice ? "fixed" : product.discountPercentage ? "percentage" : "none",
                                      discountPercent: product.discountPercentage ? String(product.discountPercentage) : "",
                                      discountValue: product.discountPrice
                                        ? String(((product.price - (product.discountPrice ?? 0)) / 100).toFixed(2))
                                        : product.discountPercentage
                                          ? String(product.discountPercentage)
                                          : "",
                                      discountExpiry: product.discountExpiry ? String(product.discountExpiry).slice(0, 10) : "",
                                    });
                                  }}
                                  className="h-8 w-8 rounded-lg"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="rounded-3xl">
                                <DialogHeader>
                                  <DialogTitle>პროდუქტის რედაქტირება: {product.name}</DialogTitle>
                                </DialogHeader>
                                <div className="py-4 space-y-4">
                                  <div className="space-y-2">
                                    <Label>პროდუქტის სახელი</Label>
                                    <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="h-11 rounded-xl" />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>აღწერა</Label>
                                    <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="min-h-[120px] rounded-xl" />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <Label>კატეგორია</Label>
                                      <Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="h-11 rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>მარაგი</Label>
                                      <Input type="number" value={editForm.stock} onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })} className="h-11 rounded-xl" />
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>სურათის URL</Label>
                                    <Input value={editForm.imageUrl} onChange={(e) => setEditForm({ ...editForm, imageUrl: e.target.value })} className="h-11 rounded-xl" />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>ფასი (₾)</Label>
                                    <Input type="number" step="0.01" value={editForm.price} onChange={(e) => { setEditForm({ ...editForm, price: e.target.value }); setNewPrice(e.target.value); }} className="h-11 rounded-xl" />
                                  </div>

                                  <div className="space-y-2">
                                    <Label>ფასდაკლება</Label>
                                    <div className="grid grid-cols-3 gap-2 p-1 bg-muted rounded-xl">
                                      <Button type="button" variant={editForm.discountType === "none" ? "default" : "ghost"} size="sm" onClick={() => setEditForm({ ...editForm, discountType: "none", discountPercent: "", discountValue: "", discountExpiry: "" })} className="rounded-lg">არა</Button>
                                      <Button
                                        type="button"
                                        variant={editForm.discountType === "percentage" ? "default" : "ghost"}
                                        size="sm"
                                        onClick={() => {
                                          const priceCents = Math.round(parseFloat(editForm.price || "0") * 100);
                                          const pct = parseInt(editForm.discountPercent || "0");
                                          const amountCents = calcCappedDiscountAmountCents(priceCents, pct);
                                          setEditForm({
                                            ...editForm,
                                            discountType: "percentage",
                                            discountValue: ((amountCents || 0) / 100).toFixed(2),
                                          });
                                        }}
                                        className="rounded-lg"
                                      >
                                        %
                                      </Button>
                                      <Button type="button" variant={editForm.discountType === "fixed" ? "default" : "ghost"} size="sm" onClick={() => setEditForm({ ...editForm, discountType: "fixed", discountValue: editForm.discountValue || "" })} className="rounded-lg">₾</Button>
                                    </div>
                                  </div>

                                  {editForm.discountType !== "none" && (
                                    <div className="grid grid-cols-2 gap-4">
                                      {editForm.discountType === "percentage" ? (
                                        <>
                                          <div className="space-y-2">
                                            <Label>ფასდაკლება (%)</Label>
                                            <Input
                                              type="number"
                                              value={editForm.discountPercent}
                                              onChange={(e) => {
                                                const priceCents = Math.round(parseFloat(editForm.price || "0") * 100);
                                                const pct = parseInt(e.target.value || "0");
                                                const pctSafe = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
                                                const amountCents = calcCappedDiscountAmountCents(priceCents, pctSafe);
                                                setEditForm({
                                                  ...editForm,
                                                  discountPercent: String(pctSafe),
                                                  discountValue: ((amountCents || 0) / 100).toFixed(2),
                                                });
                                              }}
                                              className="h-11 rounded-xl"
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <Label>მოაკლდება (₾) (max 300)</Label>
                                            <Input readOnly value={editForm.discountValue} className="h-11 rounded-xl bg-muted" />
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="space-y-2">
                                            <Label>ფასდაკლება (₾) (max 300)</Label>
                                            <Input
                                              type="number"
                                              step="0.01"
                                              value={editForm.discountValue}
                                              onChange={(e) => {
                                                const raw = e.target.value;
                                                const fixedCents = Math.min(Math.round(parseFloat(raw || "0") * 100), maxDiscountCents);
                                                setEditForm({ ...editForm, discountValue: ((fixedCents || 0) / 100).toFixed(2) });
                                              }}
                                              className="h-11 rounded-xl"
                                            />
                                          </div>
                                          <div className="space-y-2">
                                            <Label></Label>
                                            <Input readOnly value={""} className="h-11 rounded-xl bg-muted" />
                                          </div>
                                        </>
                                      )}
                                      <div className="space-y-2">
                                        <Label>ვადის გასვლა (არასავალდებულო)</Label>
                                        <Input type="date" value={editForm.discountExpiry} onChange={(e) => setEditForm({ ...editForm, discountExpiry: e.target.value })} className="h-11 rounded-xl" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <DialogFooter>
                                  <Button onClick={handleUpdatePrice} className="w-full h-12 rounded-xl font-bold">შენახვა</Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            <Dialog open={discountingProduct?.id === product.id} onOpenChange={(open) => !open && setDiscountingProduct(null)}>
                              <DialogTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => { setDiscountingProduct(product); setDiscountValue(""); }} className="h-8 w-8 rounded-lg text-orange-600">
                                  <Tag className="w-4 h-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="rounded-3xl">
                                <DialogHeader>
                                  <DialogTitle>ფასდაკლების დაყენება: {product.name}</DialogTitle>
                                </DialogHeader>
                                <div className="py-4 space-y-4">
                                  <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl">
                                    <Button 
                                      variant={discountType === "percentage" ? "default" : "ghost"} 
                                      size="sm" 
                                      onClick={() => setDiscountType("percentage")}
                                      className="rounded-lg"
                                    >პროცენტული</Button>
                                    <Button 
                                      variant={discountType === "fixed" ? "default" : "ghost"} 
                                      size="sm" 
                                      onClick={() => setDiscountType("fixed")}
                                      className="rounded-lg"
                                    >ფიქსირებული</Button>
                                  </div>
                                  <div className="space-y-2">
                                    <Label>{discountType === "percentage" ? "ფასდაკლება (%)" : "ფასდაკლება (₾)"}</Label>
                                    <Input 
                                      type="number"
                                      value={discountValue}
                                      onChange={e => setDiscountValue(e.target.value)}
                                      className="h-12 rounded-xl text-lg font-bold"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>ვადის გასვლა (არასავალდებულო)</Label>
                                    <Input 
                                      type="date"
                                      value={discountExpiry}
                                      onChange={e => setDiscountExpiry(e.target.value)}
                                      className="h-12 rounded-xl"
                                    />
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button onClick={handleSetDiscount} className="w-full h-12 rounded-xl font-bold bg-orange-600 hover:bg-orange-700">დაყენება</Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>

                            <Button size="icon" variant="ghost" onClick={() => handleDeleteProduct(product.id)} className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </AnimatePresence>
                </TableBody>
              </Table>
              {isLoading && (
                <div className="p-8 flex items-center justify-center">
                  <Loader2 className="animate-spin text-primary" />
                </div>
              )}
              {!isLoading && filteredProducts.length === 0 && (
                <div className="p-12 text-center text-muted-foreground">
                  თქვენი ძიების მიხედვით პროდუქტები ვერ მოიძებნა.
                </div>
              )}
            </CardContent>
          </Card>

          {dealer === "gorgia" && (
            <Card className="lg:col-span-2 border-2 shadow-sm rounded-3xl overflow-hidden mt-8">
              <CardHeader className="bg-muted/30 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xl">გორგია ფილიალები</CardTitle>
                  <CardDescription>დამატება, რედაქტირება და წაშლა</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="md:col-span-2">
                    <Label>ფილიალის სახელი</Label>
                    <Input
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="ახალი ფილიალის სახელი"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button className="h-11" onClick={handleAddBranch} disabled={!newBranchName.trim()}>
                      დამატება
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {isBranchLoading ? (
                    <div className="p-8 flex items-center justify-center">
                      <Loader2 className="animate-spin text-primary" />
                    </div>
                  ) : branches.length === 0 ? (
                    <div className="text-muted-foreground">ფილიალები ვერ მოიძებნა.</div>
                  ) : (
                    <div className="space-y-3">
                      {branches.map((branch) => (
                        <div key={branch.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20">
                          <div className="font-medium">{branch.name}</div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingBranch(branch);
                                setBranchNameDraft(branch.name);
                              }}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => handleDeleteBranch(branch.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {editingBranch && (
                    <Dialog open={!!editingBranch} onOpenChange={(open) => !open && setEditingBranch(null)}>
                      <DialogContent className="rounded-3xl">
                        <DialogHeader>
                          <DialogTitle>ფილიალის რედაქტირება</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>ფილიალის სახელი</Label>
                            <Input
                              value={branchNameDraft}
                              onChange={(e) => setBranchNameDraft(e.target.value)}
                              className="h-11 rounded-xl"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button onClick={handleUpdateBranch} className="w-full h-12 rounded-xl font-bold">
                            შენახვა
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          )}
        </div>}
      </div>
    </div>
  );
}
