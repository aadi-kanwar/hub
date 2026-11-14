"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CountryCode } from "libphonenumber-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { displayNameSchema, passwordProblem, roomNumberSchema } from "@convex/lib/inputRules";
import { Brand } from "@/components/app/brand";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { friendlyError } from "@/lib/errors";
import { COUNTRY_OPTIONS, toE164 } from "@/lib/phone";

const schema = z
  .object({
    joinCode: z.string().trim().min(1, "Enter your PG's join code."),
    name: displayNameSchema,
    roomNumber: roomNumberSchema,
    country: z.string(),
    phone: z.string().trim().min(1, "Enter your mobile number."),
    password: z.string(),
  })
  .superRefine((values, ctx) => {
    const phone = toE164(values.country as CountryCode, values.phone);
    if (phone === null) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number." });
    }
    const problem = passwordProblem(values.password, phone);
    if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
  });

type FormValues = z.infer<typeof schema>;

/**
 * Resident sign-up. The join code (from the PG) decides which property they
 * join. Wardens, managers and staff don't sign up: an admin adds them.
 */
export default function SignUpPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { joinCode: "", name: "", roomNumber: "", country: "IN", phone: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn("phone-password", {
        flow: "signUp",
        phone: toE164(values.country as CountryCode, values.phone)!,
        password: values.password,
        name: values.name,
        roomNumber: values.roomNumber,
        joinCode: values.joinCode,
      });
      router.replace("/");
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Brand size="lg" />
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">
          Join your <em className="text-primary-soft">PG.</em>
        </h1>
        <p className="text-foreground-secondary">
          For residents. Your PG gives you the join code. Staff and wardens are added by the admin.
        </p>
      </div>
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
            <Field id="joinCode" label="Join code" hint="6 letters and numbers, e.g. K7M2PX." error={errors.joinCode?.message}>
              {(p) => (
                <Input
                  {...p}
                  {...form.register("joinCode")}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono uppercase"
                />
              )}
            </Field>
            <Field id="name" label="Full name" error={errors.name?.message}>
              {(p) => <Input {...p} {...form.register("name")} autoComplete="name" />}
            </Field>
            <Field id="roomNumber" label="Room number" error={errors.roomNumber?.message}>
              {(p) => <Input {...p} {...form.register("roomNumber")} autoComplete="off" />}
            </Field>
            <Field id="country" label="Country">
              {(p) => (
                <NativeSelect {...p} {...form.register("country")} autoComplete="tel-country-code">
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id="phone" label="Mobile number" error={errors.phone?.message}>
              {(p) => (
                <Input {...p} {...form.register("phone")} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" />
              )}
            </Field>
            <Field id="password" label="Choose a password" hint="At least 8 characters." error={errors.password?.message}>
              {(p) => <PasswordInput {...p} {...form.register("password")} autoComplete="new-password" />}
            </Field>
            <Button type="submit" width="full" loading={isSubmitting}>
              Sign up
            </Button>
          </form>
        </CardBody>
      </Card>
      <p className="text-center text-sm text-foreground-secondary">
        Already have an account?{" "}
        <Link href="/signin" className="font-medium text-primary-text underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
