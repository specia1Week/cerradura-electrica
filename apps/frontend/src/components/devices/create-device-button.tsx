'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DeviceDialog } from '@/components/devices/device-dialog';

export function CreateDeviceButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Nuevo dispositivo
      </Button>
      <DeviceDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
