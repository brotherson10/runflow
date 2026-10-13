/**
 * Consultas e mutações da área autenticada. Todas as chaves começam por
 * ["u", userId]; alterações de treinos invalidam também o dashboard, que é
 * recalculado pela API na leitura.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type GoalInput, type WorkoutInput } from "./api.ts";
import { userKeys } from "./query.ts";

export function useDashboard(userId: string, from: string, to: string) {
  return useQuery({
    queryKey: userKeys.dashboardPeriod(userId, from, to),
    queryFn: () => api.dashboard(from, to),
  });
}

export function useRecentWorkouts(userId: string) {
  return useQuery({
    queryKey: [...userKeys.workouts(userId), "recent"],
    queryFn: () => api.workouts.list({}, undefined, 5),
  });
}

export function useWorkoutHistory(userId: string, from: string, to: string) {
  return useInfiniteQuery({
    queryKey: userKeys.workoutList(userId, from, to),
    queryFn: ({ pageParam }) => api.workouts.list({ from, to }, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useWorkout(userId: string, id: string) {
  return useQuery({
    queryKey: userKeys.workout(userId, id),
    queryFn: () => api.workouts.get(id),
  });
}

export function useActiveGoal(userId: string) {
  return useQuery({
    queryKey: userKeys.goal(userId),
    queryFn: async () => (await api.goals.active()).goal,
  });
}

function useInvalidateWorkouts(userId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: userKeys.workouts(userId) }),
      client.invalidateQueries({ queryKey: userKeys.dashboard(userId) }),
    ]);
}

function useInvalidateGoal(userId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: userKeys.goal(userId) }),
      client.invalidateQueries({ queryKey: userKeys.dashboard(userId) }),
    ]);
}

export function useCreateWorkout(userId: string) {
  const invalidate = useInvalidateWorkouts(userId);
  return useMutation({ mutationFn: (input: WorkoutInput) => api.workouts.create(input), onSuccess: invalidate });
}

export function useUpdateWorkout(userId: string, id: string) {
  const invalidate = useInvalidateWorkouts(userId);
  return useMutation({
    mutationFn: (patch: Partial<WorkoutInput>) => api.workouts.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkout(userId: string) {
  const invalidate = useInvalidateWorkouts(userId);
  return useMutation({ mutationFn: (id: string) => api.workouts.remove(id), onSuccess: invalidate });
}

export function useCreateGoal(userId: string) {
  const invalidate = useInvalidateGoal(userId);
  return useMutation({ mutationFn: (input: GoalInput) => api.goals.create(input), onSuccess: invalidate });
}

export function useUpdateGoal(userId: string) {
  const invalidate = useInvalidateGoal(userId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<GoalInput> }) => api.goals.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useCompleteGoal(userId: string) {
  const invalidate = useInvalidateGoal(userId);
  return useMutation({ mutationFn: (id: string) => api.goals.complete(id), onSuccess: invalidate });
}

export function useReplaceGoal(userId: string) {
  const invalidate = useInvalidateGoal(userId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GoalInput }) => api.goals.replace(id, input),
    onSuccess: invalidate,
  });
}
