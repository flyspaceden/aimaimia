import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { OrderRepo } from '../repos';
import { useAuthStore } from '../store';
import type { FulfillmentInput } from '../types/domain/Fulfillment';
import { buildPickupFulfillment, isPickupRecipientValid, pickupPointsAvailable, pickupSelectionsComplete, reconcilePickupSelections, type PickupSelectionMap } from '../utils/pickupSelection';

export function usePickupSelection(companyIds: string[], address?: { id?: string; receiverName?: string; phone?: string }) {
  const userId = useAuthStore((state) => state.userId);
  const loggedIn = useAuthStore((state) => state.isLoggedIn);
  const owner = loggedIn ? userId : undefined;
  const addressOwner = useRef({ owner, value: address, blocked: undefined as typeof address });
  if (addressOwner.current.owner !== owner) {
    addressOwner.current = { owner, value: address, blocked: addressOwner.current.value };
  }
  addressOwner.current.value = address;
  const safeAddress = address && address !== addressOwner.current.blocked ? address : undefined;
  const idsKey = JSON.stringify([...new Set(companyIds.filter(Boolean))].sort());
  const ids: string[] = useMemo(() => JSON.parse(idsKey), [idsKey]);
  const [state, setState] = useState({ owner, mode: 'DELIVERY' as 'DELIVERY' | 'PICKUP', selections: {} as PickupSelectionMap, name: '', phone: '', nameEdited: false, phoneEdited: false });
  // Derive a clean state during the account-changing render, before effects run.
  const current = state.owner === owner ? state : { owner, mode: 'DELIVERY' as const, selections: {}, name: '', phone: '', nameEdited: false, phoneEdited: false };
  useEffect(() => { if (state.owner !== owner) setState(current); }, [owner]);
  const query = useQuery({
    queryKey: ['checkout-pickup-points', owner, idsKey],
    queryFn: () => OrderRepo.getPickupPoints(ids),
    enabled: Boolean(owner && ids.length),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active' && owner && ids.length) void query.refetch(); });
    return () => listener.remove();
  }, [owner, idsKey, query.refetch]);
  const groups = query.data?.ok && owner ? query.data.data : [];
  const selections = reconcilePickupSelections(groups, current.selections, ids);
  useEffect(() => {
    const result = query.data;
    if (result?.ok) setState((previous) => {
      if (previous.owner !== owner) return previous;
      const next = reconcilePickupSelections(result.data, previous.selections, ids);
      return JSON.stringify(next) === JSON.stringify(previous.selections) ? previous : { ...previous, selections: next };
    });
  }, [query.data, owner, idsKey]);
  const recipientName = current.nameEdited ? current.name : current.name || safeAddress?.receiverName || '';
  const recipientPhone = current.phoneEdited ? current.phone : current.phone || safeAddress?.phone || '';
  const loading = query.isFetching;
  const error = query.isError ? '自提点加载失败，请重试' : query.data?.ok === false ? query.data.error.displayMessage || '自提点加载失败，请重试' : undefined;
  const available = Boolean(owner && !loading && !error && pickupPointsAvailable(groups, ids));
  const ready = current.mode === 'DELIVERY' ? Boolean(safeAddress?.id) : available && isPickupRecipientValid(recipientName, recipientPhone) && pickupSelectionsComplete(groups, selections, ids);
  const fulfillment: FulfillmentInput | undefined = current.mode === 'DELIVERY'
    ? safeAddress?.id ? { mode: 'DELIVERY', addressId: safeAddress.id } : undefined
    : buildPickupFulfillment(recipientName, recipientPhone, selections, ids);
  const signature = JSON.stringify([owner, idsKey, fulfillment]);
  const snapshot = useRef({ owner, idsKey, selections, signature });
  snapshot.current = { owner, idsKey, selections, signature };
  const refresh = async () => {
    if (current.mode === 'DELIVERY') return Boolean(safeAddress?.id);
    const before = snapshot.current;
    const result = await query.refetch();
    return before.signature === snapshot.current.signature && before.owner === snapshot.current.owner && before.idsKey === snapshot.current.idsKey
      && JSON.stringify(before.selections) === JSON.stringify(snapshot.current.selections)
      && result.data?.ok === true && pickupSelectionsComplete(result.data.data, before.selections, ids);
  };
  return { mode: current.mode, setMode: (mode: 'DELIVERY' | 'PICKUP') => setState({ ...current, name: recipientName, phone: recipientPhone, mode }), fulfillment, ready, groups, selections,
    setSelection: (companyId: string, pickupPointId: string) => setState({ ...current, selections: { ...selections, [companyId]: pickupPointId } }),
    recipientName, setRecipientName: (name: string) => setState({ ...current, name, nameEdited: true }),
    recipientPhone, setRecipientPhone: (phone: string) => setState({ ...current, phone, phoneEdited: true }),
    loading, error, retry: () => { void query.refetch(); }, refresh, available };
}
export type PickupSelection = ReturnType<typeof usePickupSelection>;
