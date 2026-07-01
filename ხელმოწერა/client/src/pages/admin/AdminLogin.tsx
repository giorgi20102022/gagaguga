import { useState } from "react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, Store } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useAdminAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast({
        title: "წარმატებით",
        description: "თქვენ წარმატებით შეხვედით სისტემაში",
      });
    } catch (err) {
      toast({
        title: "შეცდომა",
        description: "ელ-ფოსტა ან პაროლი არასწორია",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ─── Blue Branding Sidebar ─── */}
      <motion.div
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="hidden lg:flex lg:w-[480px] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 text-white flex-col justify-between p-10 relative overflow-hidden"
      >
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-white rounded-full blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] bg-blue-300 rounded-full blur-[100px]" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-sm">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <span className="text-2xl font-bold tracking-tight">GabulaIze</span>
          </div>

          <h1 className="text-4xl font-extrabold leading-tight mb-4">
            დილერის განაცხადების<br />პორტალი
          </h1>
          <p className="text-blue-100/80 text-lg leading-relaxed max-w-sm">
            სუპერ ადმინის მართვის პანელი — დილერების შექმნა, რედაქტირება და მონიტორინგი ერთი ადგილიდან.
          </p>
        </div>

        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-3 text-blue-100/70">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">✓</div>
            <span>დილერების CRUD მართვა</span>
          </div>
          <div className="flex items-center gap-3 text-blue-100/70">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">✓</div>
            <span>პროდუქტების და ფილიალების კონტროლი</span>
          </div>
          <div className="flex items-center gap-3 text-blue-100/70">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">✓</div>
            <span>უსაფრთხო ავტორიზაცია</span>
          </div>
        </div>
      </motion.div>

      {/* ─── Login Form ─── */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-8">
            <div className="lg:hidden flex justify-center mb-4">
              <div className="p-3 bg-blue-600 rounded-2xl">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900">ადმინ ავტორიზაცია</h2>
            <p className="text-gray-500 mt-2">შეიყვანეთ სუპერ ადმინის მონაცემები</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="admin-email" className="text-sm font-semibold text-gray-700">ელ-ფოსტა</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="მაგ: admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 rounded-xl border-2 border-gray-200 bg-white focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password" className="text-sm font-semibold text-gray-700">პაროლი</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 rounded-xl border-2 border-gray-200 bg-white focus:border-blue-500 focus:ring-blue-500"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-base font-bold bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  იტვირთება...
                </>
              ) : (
                "შესვლა"
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-400">დილერი ხართ?</p>
            <Link href="/login">
              <button className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                <Store className="w-4 h-4" />
                დილერის ავტორიზაცია
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
