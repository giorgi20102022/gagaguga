import { useState } from "react";
import { useDealerAuth } from "@/hooks/use-dealer-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Store, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function DealerLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useDealerAuth();
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
    <div className="min-h-screen flex items-center justify-center bg-white p-4 relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-b from-emerald-50 to-transparent rounded-full blur-[100px] -z-10 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-[420px]"
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
            <Store className="w-9 h-9 text-emerald-600" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900">დილერის ავტორიზაცია</h1>
          <p className="text-gray-500 mt-2 text-sm">შეიყვანეთ მონაცემები სამუშაო პორტალში შესასვლელად</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-xl shadow-gray-200/50 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="dealer-email" className="text-sm font-semibold text-gray-700">ელ-ფოსტა</Label>
              <Input
                id="dealer-email"
                type="email"
                placeholder="მაგ: dealer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-12 rounded-xl border-2 border-gray-200 bg-gray-50 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dealer-password" className="text-sm font-semibold text-gray-700">პაროლი</Label>
              <Input
                id="dealer-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-12 rounded-xl border-2 border-gray-200 bg-gray-50 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500 transition-colors"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-base font-bold bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20"
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
        </div>

        {/* Link to Admin Login */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-400">ადმინისტრატორი ხართ?</p>
          <Link href="/admin/login">
            <button className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-blue-600 transition-colors">
              <ShieldCheck className="w-4 h-4" />
              ადმინ ავტორიზაცია
            </button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
