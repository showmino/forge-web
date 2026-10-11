"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { OperationLog } from "@/components/operation-log";
import { TextLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";

// One operation, live until it ends.
export default function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const queries = useQueryClient();
  return (
    <>
      <PageHeader title="Operation" lead={<span className="type-code">operations/{id}</span>} />
      <OperationLog
        key={id}
        name={`operations/${id}`}
        link={false}
        onDone={() => void queries.invalidateQueries({ queryKey: ["operations"] })}
      />
      <p>
        <TextLink href="/operations">All operations</TextLink>
      </p>
    </>
  );
}
