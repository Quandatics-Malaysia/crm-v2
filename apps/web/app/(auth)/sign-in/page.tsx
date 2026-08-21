"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function SignInPage() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [showEmail, setShowEmail] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")

  async function signInWithMicrosoft() {
    setLoading(true)
    const { error } = await authClient.signIn.oauth2({
      providerId: "microsoft-entra-id",
      callbackURL: "/dashboard",
    })
    if (error) {
      setLoading(false)
      toast.error(
        error.message ??
          "Microsoft sign-in failed. Try again or contact your administrator."
      )
    }
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.signIn.email({ email, password })
    setLoading(false)
    if (error) {
      toast.error("Invalid email or password")
      return
    }
    router.push("/dashboard")
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Sign in to CRM</CardTitle>
        <CardDescription>Use your Microsoft account to continue</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button
          onClick={signInWithMicrosoft}
          disabled={loading}
          className="w-full"
        >
          <MicrosoftLogo />
          Continue with Microsoft
        </Button>

        {showEmail ? (
          <form onSubmit={signInWithEmail} className="grid gap-3">
            <div className="relative my-1 text-center text-xs text-muted-foreground">
              <span className="bg-card px-2">or sign in with email</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={loading}>
              Sign in
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setShowEmail(true)}
          >
            Use email and password
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Email sign-in is enabled per entity for provisioned accounts only.
        </p>
      </CardContent>
    </Card>
  )
}

function MicrosoftLogo() {
  return (
    <svg className="size-4" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}
