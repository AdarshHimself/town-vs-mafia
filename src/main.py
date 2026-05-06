# src/main.py - Town vs Mafia: AI Edition — Game Engine
import random
from collections import Counter
from src.agents import MafiaAgent
from src.agent_interfaces import create_agent_interface

class GameState:
    def __init__(self, agents, discussion_rounds, event_callback=None, stop_flag=None, pause_flag=None):
        self.agents = agents
        self.round = 0
        self.discussion_rounds = discussion_rounds
        self.message_log = []
        self.llm = agents[0].llm if agents else None
        self.composition = Counter(agent.role for agent in agents)
        self.game_sequence = []
        self.step_counter = 0
        self.event_callback = event_callback or (lambda e: None)
        self.stop_flag = stop_flag  # threading.Event — set to request game stop
        self.pause_flag = pause_flag

    def emit(self, event_type, **kwargs):
        self.check_stop()
        self.event_callback({"type": event_type, **kwargs})

    def check_stop(self):
        if self.stop_flag and self.stop_flag.is_set():
            raise RuntimeError("Game stopped by user")
        if self.pause_flag and self.pause_flag.is_set():
            import time
            while self.pause_flag.is_set() and not (self.stop_flag and self.stop_flag.is_set()):
                time.sleep(0.5)
            if self.stop_flag and self.stop_flag.is_set():
                raise RuntimeError("Game stopped by user")

    def get_alive_players(self):
        return [a for a in self.agents if a.alive]

    def get_active_players(self):
        return [a for a in self.agents if a.alive and not a.imprisoned]

    def get_agent_by_name(self, name):
        return next((a for a in self.agents if a.name == name), None)

    def get_alive_names(self):
        return [a.name for a in self.get_alive_players()]

    def get_active_names(self):
        return [a.name for a in self.get_active_players()]

    def get_composition_string(self) -> str:
        parts = []
        for role in ['mafia', 'detective', 'doctor', 'villager']:
            count = self.composition.get(role, 0)
            if count > 0:
                role_word = role + ('s' if count > 1 else '')
                parts.append(f"{count} {role_word}")
        return ', '.join(parts)

    def get_player_statuses(self):
        return [
            {
                "name": a.name,
                "role": a.role,
                "alive": a.alive,
                "imprisoned": a.imprisoned,
                "is_human": getattr(a, 'is_human', False),
                "model": getattr(a, 'model_label', 'AI')
            }
            for a in self.agents
        ]

    def log_action(self, action, actor, raw_response, parsed_result):
        self.step_counter += 1
        self.game_sequence.append({
            "step": self.step_counter,
            "action": action,
            "actor": actor,
            "raw_response": raw_response,
            "parsed_result": parsed_result
        })


class Game:
    def __init__(self, state, human_input_fn=None):
        self.state = state
        self.human_input_fn = human_input_fn

    def human_act(self, prompt_data):
        """Call human_input_fn if available; block game thread until UI responds."""
        if self.human_input_fn:
            return self.human_input_fn(prompt_data)
        return None

    # ── Main Loop ────────────────────────────────────────────
    def play(self):
        try:
            self.state.emit("GAME_START", players=self.state.get_player_statuses(),
                            composition=self.state.get_composition_string())
            self.reveal_roles()

            # DAY-FIRST: Round 1 starts with Day (introductions), then Night
            while self.state.round < 15:
                self.state.round += 1
                self.state.check_stop()

                # ── Day Phase ──
                self.state.emit("PHASE_CHANGE", phase="DAY", round=self.state.round,
                                players=self.state.get_player_statuses())
                self.show_status()
                self.run_day_phase()

                result = self.check_game_over()
                if result:
                    self.show_game_end(result)
                    return

                self.state.check_stop()

                # ── Night Phase ──
                self.state.emit("PHASE_CHANGE", phase="NIGHT", round=self.state.round)
                self.run_night_phase()

                result = self.check_game_over()
                if result:
                    self.show_game_end(result)
                    return

            self.state.emit("GAME_OVER", result="TIMEOUT", winner=None,
                            players=self.state.get_player_statuses())

        except RuntimeError as e:
            if "stopped" in str(e).lower():
                self.state.event_callback({"type": "GAME_STOPPED"})
            else:
                self.state.event_callback({"type": "ERROR", "message": str(e)})

    def reveal_roles(self):
        roles = {a.name: a.role for a in self.state.agents}
        self.state.emit("ROLES_REVEALED", roles=roles)

    # ── Night Phase ──────────────────────────────────────────
    def run_night_phase(self):
        active_players = self.state.get_active_players()
        if len(active_players) <= 1:
            return

        for agent in self.state.agents:
            agent.remember(f"Night {self.state.round} begins.")

        killed_player, saved_player = self.night_actions()

        if saved_player:
            self.state.emit("DOCTOR_SAVE", target=saved_player)
            for agent in self.state.agents:
                agent.remember("The doctor saved someone last night.")

        if killed_player:
            self.state.emit("PLAYER_KILLED", target=killed_player,
                            role=self.state.get_agent_by_name(killed_player).role)
            for agent in self.state.agents:
                agent.remember(f"{killed_player} was found dead.")
        else:
            if not saved_player:
                self.state.emit("NIGHT_NO_KILL")

    def night_actions(self):
        active_players = self.state.get_active_players()
        active_names = self.state.get_active_names()
        killed_player = None
        saved_player = None

        # ── Detectives investigate ──
        for detective in [a for a in active_players if a.role == "detective"]:
            candidates = [n for n in active_names if n != detective.name]
            if not candidates:
                continue
            if getattr(detective, 'is_human', False) and self.human_input_fn:
                target = self.human_act({"action": "investigate", "candidates": candidates, "round": self.state.round})
                if not target or target not in candidates:
                    target = random.choice(candidates)
                target_agent = self.state.get_agent_by_name(target)
                detective.remember(f"You investigated {target} and discovered they are a {target_agent.role}")
                self.state.log_action("investigate", detective.name, target, target)
            else:
                target = detective.investigate(candidates, self.state)
            target_role = self.state.get_agent_by_name(target).role
            self.state.emit("DETECTIVE_INVESTIGATE", actor=detective.name, target=target, result=target_role)

        # ── Mafia team decides kill ──
        mafia_active = [a for a in active_players if a.role == "mafia"]
        if mafia_active:
            mafia_names = [a.name for a in mafia_active]
            kill_candidates = [n for n in active_names if n not in mafia_names]

            if kill_candidates:
                kill_target = self._mafia_choose_kill(mafia_active, kill_candidates, active_names)

                if kill_target and kill_target != "SKIP":
                    # ── Doctor saves ──
                    for doctor in [a for a in active_players if a.role == "doctor"]:
                        save_candidates = [n for n in active_names if n != doctor.name]
                        if not save_candidates:
                            continue
                        if getattr(doctor, 'is_human', False) and self.human_input_fn:
                            st = self.human_act({"action": "save", "candidates": save_candidates, "round": self.state.round})
                            if not st or st not in save_candidates:
                                st = random.choice(save_candidates)
                            doctor.remember(f"You protected {st} tonight.")
                            self.state.log_action("save", doctor.name, st, st)
                        else:
                            st = doctor.save(save_candidates, self.state)
                        if st == kill_target:
                            saved_player = kill_target
                            break

                    if saved_player:
                        # Kill blocked
                        pass
                    else:
                        victim = self.state.get_agent_by_name(kill_target)
                        victim.alive = False
                        killed_player = kill_target

                    # Inform all mafia of kill outcome
                    for m in [a for a in self.state.agents if a.role == "mafia" and a.alive]:
                        if saved_player:
                            m.remember(f"The doctor blocked the mafia kill on {kill_target}.")
                        else:
                            m.remember(f"The mafia killed {kill_target} tonight.")
                else:
                    for m in [a for a in self.state.agents if a.role == "mafia" and a.alive]:
                        m.remember("The mafia team chose to skip killing tonight.")

        return killed_player, saved_player

    def _mafia_choose_kill(self, mafia_active, kill_candidates, active_names):
        """Mafia team night discussion and collective kill vote."""
        kill_candidates_with_skip = kill_candidates + ["SKIP"]
        if len(mafia_active) == 1:
            # Solo mafia — just kill directly
            mafia = mafia_active[0]
            if getattr(mafia, 'is_human', False) and self.human_input_fn:
                target = self.human_act({"action": "kill", "candidates": kill_candidates_with_skip, "round": self.state.round})
                if not target or target not in kill_candidates_with_skip:
                    target = random.choice(kill_candidates)
                mafia.remember(f"You chose to kill {target}" if target != "SKIP" else "You chose to SKIP the kill.")
                self.state.log_action("kill", mafia.name, target, target)
                return target
            else:
                return mafia.kill(kill_candidates, self.state)

        # Multiple mafia — team discussion
        mafia_names_str = ", ".join(a.name for a in mafia_active)

        # Each mafia speaks their reasoning privately
        mafia_chat_log = []
        for mafia in mafia_active:
            if getattr(mafia, 'is_human', False):
                # Human mafia sees the chat and participates
                msg = self.human_act({
                    "action": "mafia_chat",
                    "candidates": kill_candidates,
                    "round": self.state.round,
                    "chat_log": mafia_chat_log
                })
                if not msg:
                    msg = "I'll go along with whatever the team decides."
            else:
                # AI mafia discuss among themselves
                # Build a mini prompt for the discussion
                chat_context = "\n".join(f"{m}: {t}" for m, t in mafia_chat_log) if mafia_chat_log else "No messages yet."
                from src.prompt_utils import format_night_action_prompt
                discuss_prompt = f"""You are {mafia.name}, a mafia member. Your fellow mafia are: {mafia_names_str}.
Target candidates to kill tonight: {', '.join(kill_candidates)}.

Mafia team chat so far:
{chat_context}

In 1-2 sentences, say who you want to kill and why. Be brief."""
                try:
                    msg = mafia.llm.generate(discuss_prompt, max_tokens=80)
                except Exception:
                    msg = f"I think we should kill {random.choice(kill_candidates)}."

            mafia_chat_log.append((mafia.name, msg))
            self.state.emit("MAFIA_CHAT", actor=mafia.name, message=msg, candidates=kill_candidates)
            # All mafia remember the chat
            for m in mafia_active:
                m.remember(f"[Mafia chat] {mafia.name}: {msg}")

        # Each mafia votes on kill target
        votes = {}
        for mafia in mafia_active:
            if getattr(mafia, 'is_human', False):
                vote = self.human_act({
                    "action": "kill",
                    "candidates": kill_candidates_with_skip,
                    "round": self.state.round,
                    "is_mafia_vote": True
                })
                if not vote or vote not in kill_candidates_with_skip:
                    vote = random.choice(kill_candidates)
            else:
                vote = mafia.kill(kill_candidates, self.state)
                if vote not in kill_candidates:
                    vote = random.choice(kill_candidates)
            votes[mafia.name] = vote
            self.state.emit("MAFIA_VOTE", actor=mafia.name, target=vote)

        # Tally
        vote_counts = Counter(votes.values())
        max_v = max(vote_counts.values())
        tied = [t for t, c in vote_counts.items() if c == max_v]

        if len(tied) == 1:
            kill_target = tied[0]
        else:
            # Tie — check for human mafia player
            human_mafia = next((a for a in mafia_active if getattr(a, 'is_human', False)), None)
            if human_mafia and self.human_input_fn:
                kill_target = self.human_act({
                    "action": "mafia_tiebreak",
                    "candidates": tied,
                    "round": self.state.round
                })
                if not kill_target or kill_target not in tied:
                    kill_target = random.choice(tied)
            else:
                kill_target = random.choice(tied)
            self.state.emit("MAFIA_TIEBREAK", chosen=kill_target, tied=tied)

        self.state.emit("MAFIA_KILL_DECIDED", target=kill_target, votes=votes)
        for m in mafia_active:
            m.remember(f"The mafia team agreed to kill {kill_target} tonight.")
        return kill_target

    # ── Day Phase ────────────────────────────────────────────
    def run_day_phase(self):
        for agent in self.state.agents:
            agent.remember(f"Day {self.state.round} begins.")
        self.discussion_rounds()
        self.voting_round()

    def discussion_rounds(self):
        active_players = self.state.get_active_players()
        active_names = self.state.get_active_names()

        for round_num in range(1, self.state.discussion_rounds + 1):
            self.state.check_stop()
            self.state.emit("DISCUSSION_ROUND", round=round_num, total_rounds=self.state.discussion_rounds)
            agents_order = active_players.copy()
            random.shuffle(agents_order)

            for agent in agents_order:
                self.state.check_stop()
                all_player_names = [a.name for a in self.state.agents]

                if getattr(agent, 'is_human', False) and self.human_input_fn:
                    raw_msg = self.human_act({
                        "action": "discuss",
                        "round": round_num,
                        "active_players": active_names,
                        "all_players": all_player_names
                    })
                    if not raw_msg:
                        raw_msg = "..."
                    message = raw_msg.strip('"')
                    agent.remember(f'You: "{message}"')
                    self.state.log_action("discuss", agent.name, raw_msg, raw_msg)
                else:
                    message = agent.message(active_names, round_num, all_player_names,
                                            self.state.discussion_rounds, self.state)
                    # Strip surrounding quotes
                    message = message.strip('"').strip("'") if message else "..."

                self.state.emit("PLAYER_MESSAGE", actor=agent.name,
                                role=agent.role, message=message,
                                round=round_num, is_human=getattr(agent, 'is_human', False))

                for a in active_players:
                    if a != agent:
                        a.remember(f'{agent.name}: "{message}"')

    def voting_round(self):
        self.state.emit("VOTING_START", players=[a.name for a in self.state.get_active_players()])
        active_players = self.state.get_active_players()
        votes = {}
        vote_statuses = {}

        for agent in active_players:
            self.state.check_stop()
            candidates = [a.name for a in active_players if a != agent]
            all_player_names = [a.name for a in self.state.agents]
            candidates_with_skip = candidates + ["SKIP"]

            if getattr(agent, 'is_human', False) and self.human_input_fn:
                vote = self.human_act({
                    "action": "vote",
                    "candidates": candidates_with_skip,
                    "all_players": all_player_names
                })
                if not vote or vote not in candidates_with_skip:
                    votes[agent.name] = random.choice(candidates)
                    vote_statuses[agent.name] = False
                else:
                    votes[agent.name] = vote
                    vote_statuses[agent.name] = True
                self.state.log_action("vote", agent.name, vote, vote)
            else:
                vote, successful = agent.vote(candidates, all_player_names,
                                              self.state.discussion_rounds, self.state)
                votes[agent.name] = vote
                vote_statuses[agent.name] = successful

            self.state.emit("PLAYER_VOTE", actor=agent.name, target=votes[agent.name], role=agent.role)

        self.resolve_votes(votes, vote_statuses)

    def resolve_votes(self, votes, vote_statuses=None):
        if not votes:
            return
        vote_counts = Counter(votes.values())
        max_votes = max(vote_counts.values())
        tied = [name for name, count in vote_counts.items() if count == max_votes]

        total_votes = len(votes)
        if max_votes < total_votes / 2.0 or len(tied) > 1:
            arrested = "SKIP"
            tiebreak = False
        else:
            arrested = tied[0]
            tiebreak = False

        if arrested == "SKIP":
            self.state.emit("PLAYER_ARRESTED", target=None, role=None, votes=votes, tiebreak=tiebreak, skipped=True)
            votes_ann = "Votes: " + ", ".join(f"{v} voted for {t}" for v, t in votes.items())
            for agent in self.state.get_active_players():
                agent.remember(votes_ann)
                agent.remember("The town voted to SKIP the arrest.")
            return

        arrested_agent = self.state.get_agent_by_name(arrested)
        arrested_agent.imprisoned = True

        self.state.emit("PLAYER_ARRESTED", target=arrested,
                        role=arrested_agent.role,
                        votes=votes, tiebreak=len(tied) > 1, skipped=False)

        votes_ann = "Votes: " + ", ".join(f"{v} voted for {t}" for v, t in votes.items())
        for agent in self.state.get_active_players():
            agent.remember(votes_ann)
            agent.remember(f"{arrested} was arrested.")

    def check_game_over(self):
        active = self.state.get_active_players()
        mafia = sum(1 for a in active if a.role == "mafia")
        good  = sum(1 for a in active if a.role != "mafia")
        if mafia == 0:
            return {"winner": "TOWN",  "message": "TOWN WINS! All mafia eliminated!"}
        if mafia >= good:
            return {"winner": "MAFIA", "message": "MAFIA WINS! Town is outnumbered!"}
        return None

    def show_status(self):
        self.state.emit("STATUS_UPDATE", players=self.state.get_player_statuses())

    def show_game_end(self, result):
        self.state.emit("GAME_OVER", winner=result["winner"], message=result["message"],
                        players=self.state.get_player_statuses(),
                        game_sequence=self.state.game_sequence)


def create_game(players, discussion_rounds=2, event_callback=None,
                human_input_fn=None, stop_flag=None, pause_flag=None):
    agents = []
    for player in players:
        llm = create_agent_interface(player['llm'])
        agent = MafiaAgent(player['name'], player['role'], llm,
                           debug_prompts=False, model_config=player['llm'])
        agent.is_human  = player['llm'].get('type') == 'human'
        agent.model_label = player['llm'].get('model', player['llm'].get('type', 'AI'))
        agent.remember(f"You're {agent.name}, the {agent.role}.")
        agents.append(agent)

    state = GameState(agents, discussion_rounds,
                      event_callback=event_callback, stop_flag=stop_flag, pause_flag=pause_flag)

    # Mafia know each other
    mafia_agents = [a for a in agents if a.role == "mafia"]
    if len(mafia_agents) > 1:
        for m in mafia_agents:
            others = [a.name for a in mafia_agents if a != m]
            m.remember(f"Your fellow mafia members are: {', '.join(others)}.")

    return Game(state, human_input_fn=human_input_fn)