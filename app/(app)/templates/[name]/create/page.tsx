"use client";

import { useParams } from "next/navigation";
import { CreateService } from "@/components/create-service";

// Use one template, from its own page: the template is fixed and the
// navigation stays on Templates.
export default function TemplateCreatePage() {
  const { name } = useParams<{ name: string }>();
  return <CreateService fixed={name} />;
}
